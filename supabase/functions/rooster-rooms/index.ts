import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { corsHeaders } from "jsr:@supabase/supabase-js@2.95.0/cors";

const ALPHABET="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ONLINE_MS=5000;
const LOBBY_TTL_MS=90000;
const GAME_TTL_MS=60000;
const MAX_ROOM_AGE_MS=4*60*60*1000;
const MAX_BODY=32768;
const MAX_PAYLOAD=24576;
const INPUT_KEYS=["left","right","jump","peck","kick","guard","dash"];
const ACTION_KEYS=["jump","peck","kick","dash"];

class RoomError extends Error {
  status:number; code:string;
  constructor(status:number,code:string,message:string){super(message);this.status=status;this.code=code;}
}
const fail=(status:number,code:string,message:string):never=>{throw new RoomError(status,code,message);};
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const headers={...corsHeaders,"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});

function secretKey(){
  const modern=Deno.env.get("SUPABASE_SECRET_KEYS");
  if(modern){
    try{
      const parsed=JSON.parse(modern);
      if(parsed&&typeof parsed.default==="string") return parsed.default;
    }catch(_){}
  }
  const legacy=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(legacy) return legacy;
  throw new Error("Missing Supabase backend secret");
}
const admin=createClient(Deno.env.get("SUPABASE_URL")??"",secretKey(),{
  auth:{persistSession:false,autoRefreshToken:false}
});

function randomHex(bytes=16){
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)),b=>b.toString(16).padStart(2,"0")).join("");
}
function roomCode(){
  return Array.from(crypto.getRandomValues(new Uint8Array(6)),b=>ALPHABET[b%ALPHABET.length]).join("");
}
async function hashToken(token:string){
  if(!/^[A-Za-z0-9_-]{32,128}$/.test(token||"")) fail(401,"UNAUTHORIZED","Phiên kết nối không hợp lệ. Hãy tạo hoặc vào phòng lại.");
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function cleanName(value:unknown,role:"host"|"guest"){
  if(value!==undefined&&typeof value!=="string") fail(400,"INVALID_NAME","Tên người chơi cần là văn bản.");
  const name=String(value||"").normalize("NFC").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,"").replace(/\s+/g," ").trim();
  return Array.from(name).slice(0,24).join("")||(role==="host"?"Chủ phòng":"Bạn chơi");
}
function validTree(value:unknown,depth=0,budget={count:4096}):boolean{
  if(depth>12||--budget.count<0)return false;
  if(value===null||typeof value==="boolean")return true;
  if(typeof value==="number")return Number.isFinite(value);
  if(typeof value==="string")return value.length<=12000;
  if(Array.isArray(value))return value.length<=256&&value.every(x=>validTree(x,depth+1,budget));
  if(!object(value))return false;
  const entries=Object.entries(value);
  return entries.length<=128&&entries.every(([k,v])=>!["__proto__","prototype","constructor"].includes(k)&&validTree(v,depth+1,budget));
}
function validatePayload(payload:unknown,role:"host"|"guest"){
  if(!object(payload)||!validTree(payload))fail(400,"INVALID_PAYLOAD","Dữ liệu trận đấu không hợp lệ.");
  if(Object.keys(payload).some(k=>!["state","input","control"].includes(k)))fail(400,"INVALID_PAYLOAD","Dữ liệu trận đấu không hợp lệ.");
  if(role==="guest"&&payload.state!==undefined)fail(403,"WRONG_ROLE","Chỉ chủ phòng có thể đồng bộ trạng thái trận đấu.");
  if(role==="host"&&payload.input!==undefined)fail(403,"WRONG_ROLE","Chủ phòng không được gửi phím của đối thủ.");
  if(payload.input!==undefined){
    const packet=payload.input;
    if(!object(packet)||packet.type!=="input"||!integer(packet.seq)||!object(packet.keys))fail(400,"INVALID_INPUT","Phím điều khiển không hợp lệ.");
    if(Object.entries(packet.keys).some(([k,v])=>!INPUT_KEYS.includes(k)||typeof v!=="boolean"))fail(400,"INVALID_INPUT","Phím điều khiển không hợp lệ.");
    if(packet.actions!==undefined&&(!object(packet.actions)||Object.entries(packet.actions).some(([k,v])=>!ACTION_KEYS.includes(k)||!integer(v))))fail(400,"INVALID_INPUT","Phím điều khiển không hợp lệ.");
  }
  if(payload.state!==undefined){
    const packet=payload.state;
    if(!object(packet)||!["state","start"].includes(String(packet.type))||!integer(packet.seq)||!object(packet.state))fail(400,"INVALID_STATE","Trạng thái trận đấu không hợp lệ.");
  }
  const serialized=JSON.stringify(payload);
  if(new TextEncoder().encode(serialized).byteLength>MAX_PAYLOAD)fail(413,"PAYLOAD_TOO_LARGE","Dữ liệu trận đấu quá lớn. Hãy tải lại trò chơi.");
  return payload;
}
function isExpired(row:any,now:number){
  if(Number(row.expires_at)<=now||now-Number(row.created_at)>MAX_ROOM_AGE_MS)return true;
  const ttl=row.status==="playing"?GAME_TTL_MS:LOBBY_TTL_MS;
  if(now-Number(row.host_seen)>ttl)return true;
  return !!row.guest_hash&&now-Number(row.guest_seen||0)>GAME_TTL_MS;
}
function responseData(row:any,role:"host"|"guest",now:number){
  const other=role==="host"?"guest":"host";
  return {
    code:row.code,role,
    room:{
      code:row.code,status:row.status,matchId:row.match_id,peerKey:row.peer_key,
      host:{name:row.host_name,ready:!!row.host_ready,online:row.status!=="closed"&&now-Number(row.host_seen)<=ONLINE_MS},
      guest:row.guest_hash?{name:row.guest_name||"Bạn chơi",ready:!!row.guest_ready,online:row.status!=="closed"&&now-Number(row.guest_seen||0)<=ONLINE_MS}:null
    },
    peer:{seq:Number(row[other+"_seq"]||0),payload:row[other+"_payload"]||{}},
    serverTime:now
  };
}
async function getRoom(code:string){
  const {data,error}=await admin.from("game_rooms").select("*").eq("code",code).maybeSingle();
  if(error)throw error;
  return data;
}
async function requireActive(row:any,now:number){
  if(row.status==="closed")fail(410,"ROOM_CLOSED","Phòng đã đóng. Hãy tạo phòng mới để tiếp tục.");
  if(isExpired(row,now)){
    await admin.from("game_rooms").update({status:"closed",updated_at:now,expires_at:now+60000}).eq("code",row.code).neq("status","closed");
    fail(410,"ROOM_CLOSED","Phòng đã hết thời gian kết nối. Hãy tạo phòng mới.");
  }
}
async function createRoom(body:any,now:number){
  const hash=await hashToken(String(body.sessionToken||""));
  const name=cleanName(body.name,"host");
  const {data:existing,error:e1}=await admin.from("game_rooms").select("*").eq("host_hash",hash).maybeSingle();
  if(e1)throw e1;
  if(existing){await requireActive(existing,now);return json(responseData(existing,"host",now));}
  for(let attempt=0;attempt<5;attempt++){
    const code=roomCode();
    const row={code,match_id:randomHex(),peer_key:randomHex(),host_hash:hash,host_name:name,host_seen:now,created_at:now,updated_at:now,expires_at:now+LOBBY_TTL_MS};
    const {data,error}=await admin.from("game_rooms").insert(row).select("*").maybeSingle();
    if(!error&&data)return json(responseData(data,"host",now),201);
    if(error&&!/duplicate|unique/i.test(error.message||""))throw error;
    const {data:raced}=await admin.from("game_rooms").select("*").eq("host_hash",hash).maybeSingle();
    if(raced){await requireActive(raced,now);return json(responseData(raced,"host",now));}
  }
  fail(503,"CREATE_RETRY","Máy chủ đang bận. Hãy thử tạo phòng lại.");
}
async function joinRoom(code:string,body:any,now:number){
  const hash=await hashToken(String(body.sessionToken||""));
  const name=cleanName(body.name,"guest");
  let row=await getRoom(code);
  if(!row)fail(404,"ROOM_NOT_FOUND","Không tìm thấy phòng. Hãy kiểm tra lại mã 6 ký tự.");
  await requireActive(row,now);
  if(row.host_hash===hash)fail(409,"ALREADY_HOST","Bạn đang là chủ phòng này. Hãy gửi mã cho bạn của bạn.");
  if(row.guest_hash===hash)return json(responseData(row,"guest",now));
  if(row.guest_hash||row.status!=="waiting")fail(409,"ROOM_FULL","Phòng đã đủ hai người. Hãy dùng mã phòng khác.");
  const {data,error}=await admin.from("game_rooms")
    .update({guest_hash:hash,guest_name:name,guest_seen:now,guest_ready:false,updated_at:now,expires_at:now+LOBBY_TTL_MS})
    .eq("code",code).eq("status","waiting").is("guest_hash",null)
    .select("*").maybeSingle();
  if(error&&/duplicate|unique/i.test(error.message||""))fail(409,"SESSION_IN_USE","Phiên kết nối này đã ở phòng khác.");
  if(error)throw error;
  if(!data){
    row=await getRoom(code);
    if(row&&row.guest_hash===hash)return json(responseData(row,"guest",now));
    fail(409,"ROOM_FULL","Phòng đã đủ hai người. Hãy dùng mã phòng khác.");
  }
  return json(responseData(data,"guest",now));
}
async function memberAction(req:Request,code:string,action:string,body:any,now:number){
  const auth=req.headers.get("authorization")||"";
  const hash=await hashToken(auth.startsWith("Bearer ")?auth.slice(7):"");
  let row=await getRoom(code);
  if(!row)fail(404,"ROOM_NOT_FOUND","Không tìm thấy phòng. Hãy kiểm tra mã hoặc tạo phòng mới.");
  const role:("host"|"guest"|null)=row.host_hash===hash?"host":row.guest_hash===hash?"guest":null;
  if(!role)fail(401,"UNAUTHORIZED","Bạn chưa tham gia phòng này. Hãy nhập mã phòng để tham gia.");
  if(action==="leave"){
    const {data,error}=await admin.from("game_rooms").update({status:"closed",updated_at:now,expires_at:now+60000}).eq("code",code).select("*").single();
    if(error)throw error; return json(responseData(data,role,now));
  }
  await requireActive(row,now);
  const ttl=row.status==="playing"?GAME_TTL_MS:LOBBY_TTL_MS;
  if(action==="sync"){
    if(!integer(body.seq))fail(400,"INVALID_SEQUENCE","Thứ tự dữ liệu kết nối không hợp lệ.");
    const payload=validatePayload(body.payload||{},role);
    const seenKey=role+"_seen",seqKey=role+"_seq",payloadKey=role+"_payload";
    const seq=Number(body.seq);
    const update:any={[seenKey]:now,updated_at:now,expires_at:now+ttl};
    if(seq>Number(row[seqKey]||0)){update[seqKey]=seq;update[payloadKey]=payload;}
    const {data,error}=await admin.from("game_rooms").update(update).eq("code",code).neq("status","closed").select("*").maybeSingle();
    if(error)throw error;if(!data)fail(410,"ROOM_CLOSED","Phòng đã đóng. Hãy tạo phòng mới.");
    return json(responseData(data,role,now));
  }
  if(action==="ready"){
    if(typeof body.ready!=="boolean")fail(400,"INVALID_READY","Trạng thái sẵn sàng không hợp lệ.");
    if(row.status!=="waiting")fail(409,"ALREADY_PLAYING","Trận đấu đã bắt đầu.");
    const update:any={[role+"_ready"]:body.ready,[role+"_seen"]:now,updated_at:now,expires_at:now+LOBBY_TTL_MS};
    const {data,error}=await admin.from("game_rooms").update(update).eq("code",code).eq("status","waiting").select("*").maybeSingle();
    if(error)throw error;if(!data)fail(409,"ALREADY_PLAYING","Trận đấu đã bắt đầu hoặc phòng đã đóng.");
    return json(responseData(data,role,now));
  }
  if(action==="start"){
    if(role!=="host")fail(403,"HOST_ONLY","Chỉ chủ phòng có thể bắt đầu trận đấu.");
    if(row.status==="playing")return json(responseData(row,role,now));
    if(!row.guest_hash||!row.host_ready||!row.guest_ready||now-Number(row.host_seen)>ONLINE_MS||now-Number(row.guest_seen||0)>ONLINE_MS){
      fail(409,"NOT_READY","Cần đủ hai người đang kết nối và cùng nhấn Sẵn sàng.");
    }
    const {data,error}=await admin.from("game_rooms").update({status:"playing",host_seen:now,updated_at:now,expires_at:now+GAME_TTL_MS})
      .eq("code",code).eq("status","waiting").select("*").maybeSingle();
    if(error)throw error;if(!data){row=await getRoom(code);if(row?.status==="playing")return json(responseData(row,role,now));fail(409,"NOT_READY","Trận đấu chưa thể bắt đầu.");}
    return json(responseData(data,role,now));
  }
  fail(404,"NOT_FOUND","Không tìm thấy thao tác này.");
}
async function readBody(req:Request){
  const len=Number(req.headers.get("content-length")||0);
  if(len>MAX_BODY)fail(413,"BODY_TOO_LARGE","Dữ liệu kết nối quá lớn.");
  let body:any={};
  try{body=await req.json();}catch(_){fail(400,"INVALID_JSON","Dữ liệu kết nối không hợp lệ.");}
  if(!object(body))fail(400,"INVALID_JSON","Dữ liệu kết nối không hợp lệ.");
  return body;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  try{
    if(req.method!=="POST")return new Response(JSON.stringify({error:"Thao tác này cần gửi bằng POST.",code:"METHOD_NOT_ALLOWED"}),{status:405,headers:{...headers,Allow:"POST"}});
    const body=await readBody(req);
    const path=new URL(req.url).pathname.replace(/\/$/,"");
    const create=/\/api\/rooms$/.test(path);
    const route=/\/api\/rooms\/([A-Z0-9]{6})\/(join|sync|ready|start|leave)$/.exec(path);
    if(!create&&!route)fail(404,"NOT_FOUND","Đường dẫn phòng không hợp lệ.");
    const now=Date.now();
    if(create)return await createRoom(body,now);
    const code=route![1],action=route![2];
    if(action==="join")return await joinRoom(code,body,now);
    return await memberAction(req,code,action,body,now);
  }catch(error){
    if(error instanceof RoomError)return json({error:error.message,code:error.code},error.status);
    console.error("rooster-rooms failure",error instanceof Error?error.message:String(error));
    return json({error:"Máy chủ phòng tạm thời không phản hồi. Hãy thử lại sau ít giây.",code:"SERVER_ERROR"},503);
  }
});
