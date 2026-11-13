/* Direct PeerJS fallback for Online mode when the relay API is unreachable.
 * It mirrors the small subset of RoosterNet used by game-app.js. */
(function(root){
  'use strict';
  const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const cleanCode=value=>String(value||'').trim().toUpperCase().replace(/[\s-]/g,'');
  const validCode=value=>/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(cleanCode(value));
  const cleanName=value=>Array.from(String(value||'Người chơi').normalize('NFC').trim()).slice(0,24).join('')||'Người chơi';
  const clampPower=value=>Math.max(70,Math.min(130,Number(value)||100));
  const randomCode=()=>{
    const bytes=root.crypto.getRandomValues(new Uint8Array(6));
    return Array.from(bytes,b=>ALPHABET[b%ALPHABET.length]).join('');
  };
  const peerId=code=>'rooster-direct-v1-'+cleanCode(code).toLowerCase();
  const playerShape=(name,player={})=>({
    name:cleanName(name),
    roosterName:cleanName(player.roosterName||name||'Chiến kê'),
    powerRating:clampPower(player.powerRating),
    ready:false,
    online:true
  });

  class DirectPeerRoom {
    constructor(options={}){
      this.options=options;
      this.onStatus=options.onStatus||(()=>{});
      this.onLobby=options.onLobby||(()=>{});
      this.onConnect=options.onConnect||(()=>{});
      this.onData=options.onData||(()=>{});
      this.onDisconnect=options.onDisconnect||(()=>{});
      this.role=null;
      this.room='';
      this.lobby=null;
      this.connected=false;
      this.ping=0;
      this.transport='peer';
      this.isDirectFallback=true;
      this.peer=null;
      this.connection=null;
      this._closed=false;
      this._hello=null;
    }
    _emit(state,message){this.onStatus({state,message,room:this.room,role:this.role,ping:this.ping,transport:'peer'});}
    _peerOptions(){
      return {
        host:'0.peerjs.com',port:443,path:'/',secure:true,debug:0,
        config:{iceServers:[
          {urls:'stun:stun.l.google.com:19302'},
          {urls:'stun:stun1.l.google.com:19302'}
        ]}
      };
    }
    _destroyPeer(){
      try{if(this.connection&&this.connection.open)this.connection.close();}catch(_){}
      try{if(this.peer&&!this.peer.destroyed)this.peer.destroy();}catch(_){}
      this.connection=null;this.peer=null;
    }
    _broadcastLobby(){
      this.onLobby(this.lobby);
      if(this.connection&&this.connection.open){
        try{this.connection.send({kind:'lobby',room:this.lobby});}catch(_){}
      }
    }
    _attachConnection(conn){
      if(this.connection&&this.connection!==conn){try{this.connection.close();}catch(_){}}
      this.connection=conn;
      conn.on('data',data=>this._receive(data));
      conn.on('close',()=>{
        if(this._closed)return;
        if(this.role==='host'&&this.lobby&&this.lobby.status==='waiting'){
          this.lobby.guest=null;this.connected=false;this._broadcastLobby();
          this._emit('hosting','Bạn vừa rời phòng. Link mời vẫn dùng được.');
          return;
        }
        this.connected=false;this.onDisconnect('Kết nối trực tiếp với đối thủ đã đóng.');
      });
      conn.on('error',()=>{if(!this._closed)this._emit('reconnecting','Kết nối trực tiếp đang gián đoạn…');});
    }
    _receive(data){
      if(!data||typeof data!=='object')return;
      if(this.role==='host'){
        if(data.kind==='hello'&&this.lobby&&this.lobby.status==='waiting'){
          const hello=data.player&&typeof data.player==='object'?data.player:{};
          this.lobby.guest=playerShape(data.name,hello);
          this._broadcastLobby();
          this._emit('waiting','Hai người đã vào phòng. Cả hai nhấn Sẵn sàng.');
          return;
        }
        if(data.kind==='ready'&&this.lobby&&this.lobby.guest){
          this.lobby.guest.ready=!!data.ready;this._broadcastLobby();return;
        }
      }else if(this.role==='guest'&&data.kind==='lobby'&&data.room&&data.room.code===this.room){
        this.lobby=data.room;this.onLobby(this.lobby);
        if(this.lobby.status==='playing'&&!this.connected){
          this.connected=true;this._emit('connected','Đang chơi online · Kết nối P2P trực tiếp.');
          this.onConnect({role:'guest',room:this.room});
        }
        return;
      }
      if(data.kind==='game'&&data.packet&&this.connected){this.onData(data.packet);return;}
      if(data.kind==='leave'&&!this._closed){
        this.connected=false;this.onDisconnect('Đối thủ đã rời phòng.');
      }
    }
    async create(name,player={}){
      if(typeof root.Peer!=='function')throw new Error('Trình duyệt không hỗ trợ kết nối P2P.');
      this.close(true);this._closed=false;this.role='host';
      const hostPlayer=playerShape(name,player);
      const matchMode=player.matchMode==='progression'?'progression':'balanced';
      for(let attempt=0;attempt<4;attempt++){
        const code=randomCode();this.room=code;
        try{
          await new Promise((resolve,reject)=>{
            const peer=new root.Peer(peerId(code),this._peerOptions());this.peer=peer;
            let settled=false;
            const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('Không mở được kết nối P2P.'));}},6000);
            peer.on('open',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();});
            peer.on('connection',conn=>{this._attachConnection(conn);conn.on('open',()=>{});});
            peer.on('error',error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}else if(!this._closed)this._emit('reconnecting','Kết nối P2P đang gián đoạn…');});
          });
          this.lobby={code,status:'waiting',matchMode,host:hostPlayer,guest:null,transport:'peer'};
          this._broadcastLobby();
          this._emit('hosting','Phòng P2P đã mở. Chia sẻ link mời cho bạn.');
          return code;
        }catch(error){
          this._destroyPeer();
          if(error&&error.type==='unavailable-id')continue;
          if(attempt===3)throw error;
        }
      }
      throw new Error('Không tạo được phòng P2P.');
    }
    async join(code,name,player={}){
      if(typeof root.Peer!=='function')throw new Error('Trình duyệt không hỗ trợ kết nối P2P.');
      code=cleanCode(code);if(!validCode(code))throw new Error('Link phòng không hợp lệ.');
      this.close(true);this._closed=false;this.role='guest';this.room=code;
      const guest=playerShape(name,player);
      this._emit('joining','Đang nối trực tiếp tới phòng '+code+'…');
      await new Promise((resolve,reject)=>{
        const peer=new root.Peer(undefined,this._peerOptions());this.peer=peer;
        let settled=false;
        const timer=setTimeout(()=>{if(!settled){settled=true;reject(new Error('Không tìm thấy chủ phòng P2P.'));}},8000);
        peer.on('open',()=>{
          const conn=peer.connect(peerId(code),{reliable:true,serialization:'json'});
          this._attachConnection(conn);
          conn.on('open',()=>{
            if(settled)return;settled=true;clearTimeout(timer);
            try{conn.send({kind:'hello',name:guest.name,player:guest});}catch(_){}
            resolve();
          });
        });
        peer.on('error',error=>{if(!settled){settled=true;clearTimeout(timer);reject(error);}});
      });
      this._emit('joining','Đã nối tới chủ phòng · đang nhận trạng thái phòng…');
      await new Promise((resolve,reject)=>{
        const started=Date.now();
        const timer=setInterval(()=>{
          if(this.lobby){
            clearInterval(timer);
            resolve();
            return;
          }
          if(this._closed||!this.connection||!this.connection.open){
            clearInterval(timer);
            reject(new Error('Kết nối tới chủ phòng đã đóng.'));
            return;
          }
          if(Date.now()-started>6000){
            clearInterval(timer);
            reject(new Error('Chủ phòng chưa xác nhận kết nối. Hãy thử lại link mời.'));
          }
        },80);
      });
      this._emit('waiting','Đã vào phòng · chờ cả hai sẵn sàng.');
      return code;
    }
    async setReady(ready){
      if(!this.lobby&&this.role==='guest'){
        if(this.connection&&this.connection.open)this.connection.send({kind:'ready',ready:!!ready});
        return null;
      }
      if(this.role==='host'&&this.lobby){
        this.lobby.host.ready=!!ready;this._broadcastLobby();return this.lobby;
      }
      if(this.role==='guest'&&this.connection&&this.connection.open){
        if(this.lobby&&this.lobby.guest){this.lobby.guest.ready=!!ready;this.onLobby(this.lobby);}
        this.connection.send({kind:'ready',ready:!!ready});return this.lobby;
      }
      throw new Error('Chưa kết nối phòng.');
    }
    async start(){
      if(this.role!=='host'||!this.lobby||!this.lobby.guest)throw new Error('Chưa đủ hai người.');
      if(!this.lobby.host.ready||!this.lobby.guest.ready)throw new Error('Cả hai cần sẵn sàng.');
      this.lobby.status='playing';this.connected=true;this._broadcastLobby();
      this._emit('connected','Đang chơi online · Kết nối P2P trực tiếp.');
      this.onConnect({role:'host',room:this.room});
      return this.lobby;
    }
    send(packet){
      if(!this.connected||!this.connection||!this.connection.open||!packet||typeof packet!=='object')return false;
      try{this.connection.send({kind:'game',packet});return true;}catch(_){return false;}
    }
    close(silent=false){
      if(this._closed)return;
      this._closed=true;
      try{if(!silent&&this.connection&&this.connection.open)this.connection.send({kind:'leave'});}catch(_){}
      this._destroyPeer();this.connected=false;this.lobby=null;this.room='';this.role=null;
    }
  }
  DirectPeerRoom.validCode=validCode;
  root.DirectPeerRoom=DirectPeerRoom;
})(typeof window!=='undefined'?window:globalThis);
