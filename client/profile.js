(function(root){
  'use strict';
  const state={ready:false,loading:false,error:'',user:null,session:null,rooster:null,client:null};
  const clean=value=>Array.from(String(value||'').normalize('NFC').trim()).slice(0,24).join('');
  const fallbackName=value=>clean(value)||'Chiến kê';
  const mapRooster=row=>row?{
    id:row.id,
    ownerId:row.owner_id,
    name:row.name,
    grain:Number(row.grain_count||0),
    grasshopper:Number(row.grasshopper_count||0),
    hen:Number(row.hen_count||0),
    rewardScore:Number(row.reward_score||0),
    powerRating:Number(row.power_rating||100)
  }:null;

  async function ensureSession(){
    if(state.session)return state.session;
    if(!root.supabase||!root.ROOSTER_SUPABASE_URL||!root.ROOSTER_SUPABASE_KEY)throw new Error('Chưa cấu hình Supabase cho hồ sơ chiến kê.');
    if(!state.client)state.client=root.supabase.createClient(root.ROOSTER_SUPABASE_URL,root.ROOSTER_SUPABASE_KEY,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}
    });
    const current=await state.client.auth.getSession();
    if(current.error)throw current.error;
    let session=current.data.session;
    if(!session){
      const signed=await state.client.auth.signInAnonymously();
      if(signed.error)throw signed.error;
      session=signed.data.session;
    }
    if(!session)throw new Error('Không tạo được phiên người chơi.');
    state.session=session;state.user=session.user;
    return session;
  }

  async function refresh(){
    await ensureSession();
    const {data,error}=await state.client.from('game_rooster_stats').select('*').eq('owner_id',state.user.id).order('updated_at',{ascending:false}).limit(1);
    if(error)throw error;
    state.rooster=mapRooster(data&&data[0]);
    state.ready=!!state.rooster;
    return state.rooster;
  }

  async function init(displayName){
    if(state.loading)return state;
    state.loading=true;state.error='';
    try{
      await ensureSession();
      const profileName=clean(displayName)||'Người chơi';
      const profile=await state.client.from('game_profiles').upsert({id:state.user.id,display_name:profileName},{onConflict:'id'});
      if(profile.error)throw profile.error;
      await refresh();
      if(!state.rooster){
        const inserted=await state.client.from('game_roosters').insert({owner_id:state.user.id,name:fallbackName(profileName+' · Chiến kê')}).select('id').single();
        if(inserted.error)throw inserted.error;
        await refresh();
      }
      state.ready=true;
    }catch(error){
      state.error=error&&error.message?error.message:String(error);
      state.ready=false;
    }finally{state.loading=false;}
    return state;
  }

  async function rename(name){
    const next=clean(name);
    if(!next)throw new Error('Tên chiến kê không được để trống.');
    if(!state.rooster)await init(next);
    const result=await state.client.from('game_roosters').update({name:next,updated_at:new Date().toISOString()}).eq('id',state.rooster.id);
    if(result.error)throw result.error;
    await refresh();
    return state.rooster;
  }

  async function identity(){
    await ensureSession();
    const latest=await state.client.auth.getSession();
    if(latest.error)throw latest.error;
    state.session=latest.data.session||state.session;
    if(!state.rooster)await refresh();
    return {
      accessToken:state.session&&state.session.access_token||'',
      userId:state.user&&state.user.id||'',
      roosterId:state.rooster&&state.rooster.id||'',
      roosterName:state.rooster&&state.rooster.name||'Chiến kê',
      powerRating:state.rooster&&state.rooster.powerRating||100
    };
  }

  root.RoosterProfile={state,init,refresh,rename,identity};
})(typeof window!=='undefined'?window:globalThis);
