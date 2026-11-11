/* Local keyboard preferences. No account or network calls. */
(function(root){
  'use strict';
  const ACTIONS=[
    ['left','Đi sang trái'],['right','Đi sang phải'],['jump','Nhảy'],
    ['peck','Mổ nhanh'],['kick','Đá mạnh'],['guard','Giữ thế thủ'],['dash','Lướt né']
  ];
  const PRESETS={
    classic:[
      {left:'KeyA',right:'KeyD',jump:'Space',peck:'KeyJ',kick:'KeyK',guard:'KeyL',dash:'ShiftLeft'},
      {left:'ArrowLeft',right:'ArrowRight',jump:'ArrowUp',peck:'KeyU',kick:'KeyI',guard:'KeyO',dash:'ShiftRight'}
    ],
    arrows:[
      {left:'ArrowLeft',right:'ArrowRight',jump:'Space',peck:'KeyZ',kick:'KeyX',guard:'KeyC',dash:'ShiftLeft'},
      {left:'KeyA',right:'KeyD',jump:'KeyW',peck:'KeyJ',kick:'KeyK',guard:'KeyL',dash:'ShiftRight'}
    ]
  };
  const STORAGE='rooster-arena-keyboard-v2';
  const copy=v=>JSON.parse(JSON.stringify(v));
  const valid=code=>/^(Key[A-OQ-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Left|Right|Up|Down)|Space|Shift(Left|Right))$/.test(code);
  function label(code){
    const names={ArrowLeft:'←',ArrowRight:'→',ArrowUp:'↑',ArrowDown:'↓',Space:'Space',ShiftLeft:'Shift trái',ShiftRight:'Shift phải'};
    return names[code]||code.replace(/^Key/,'').replace(/^Digit/,'').replace(/^Numpad/,'Num ');
  }
  function validPlayers(players){
    if(!Array.isArray(players)||players.length!==2)return false;
    const codes=[];
    for(const player of players){
      if(!player||typeof player!=='object')return false;
      for(const [action] of ACTIONS){
        if(!valid(player[action]))return false;
        codes.push(player[action]);
      }
    }
    return new Set(codes).size===codes.length;
  }
  class RoosterControls {
    constructor(options={}){
      this.options=options;this.preset='classic';this.players=copy(PRESETS.classic);
      this.capture=null;this.storageAvailable=true;
      this.dialog=document.getElementById('controlsDialog');
      try{
        const saved=JSON.parse(localStorage.getItem(STORAGE)||'null');
        if(saved&&validPlayers(saved.players)){
          this.players=copy(saved.players);this.preset=['classic','arrows'].includes(saved.preset)?saved.preset:'custom';
        }
      }catch(_){this.storageAvailable=false;}
      this.buttons=[];
      const table=document.getElementById('bindingRows');
      for(const [action,title] of ACTIONS){
        const tr=document.createElement('tr'),th=document.createElement('th');
        th.scope='row';th.textContent=title;tr.append(th);
        [0,1].forEach(player=>{
          const td=document.createElement('td'),button=document.createElement('button');
          button.type='button';button.className='bind-button';
          button.setAttribute('aria-label','Đổi phím '+title.toLowerCase()+' cho người '+(player+1));
          button.addEventListener('click',()=>this.listen(player,action));
          td.append(button);tr.append(td);this.buttons.push({button,player,action});
        });table.append(tr);
      }
      document.querySelectorAll('[data-key-preset]').forEach(button=>{
        button.addEventListener('click',()=>this.setPreset(button.dataset.keyPreset));
      });
      document.getElementById('resetKeysBtn').addEventListener('click',()=>this.setPreset('classic'));
      document.getElementById('closeControls').addEventListener('click',()=>this.dialog.close());
      document.getElementById('saveControlsBtn').addEventListener('click',()=>this.dialog.close());
      this.dialog.addEventListener('close',()=>{
        this.capture=null;this.render();
        if(this.options.onClose)this.options.onClose();
      });
      this.dialog.addEventListener('cancel',event=>{
        if(this.capture){event.preventDefault();this.capture=null;this.render();this.message('Đã hủy đổi phím.');}
      });
      document.addEventListener('keydown',event=>this.keydown(event),true);
      this.render();
    }
    get isOpen(){return this.dialog.open;}
    open(){
      if(this.options.onOpen)this.options.onOpen();
      this.capture=null;this.render();this.message('Chọn một ô rồi nhấn phím bạn muốn dùng.');
      this.dialog.showModal();
    }
    mapping(player){return this.players[player===1?1:0];}
    keyLabel(action,player=0){return label(this.mapping(player)[action]);}
    codes(){return new Set(this.players.flatMap(p=>ACTIONS.map(([action])=>p[action])));}
    input(player,keys){
      const input={},bindings=this.mapping(player);
      for(const [action] of ACTIONS)input[action]=keys.has(bindings[action]);
      return input;
    }
    listen(player,action){
      this.capture={player,action};this.render();
      const title=ACTIONS.find(item=>item[0]===action)[1];
      this.message('Nhấn phím mới cho “'+title+'” của người '+(player+1)+'. Esc để hủy.');
    }
    keydown(event){
      if(!this.dialog.open||!this.capture)return;
      event.preventDefault();event.stopImmediatePropagation();
      if(event.repeat)return;
      if(event.code==='Escape'){this.capture=null;this.render();this.message('Đã hủy đổi phím.');return;}
      if(event.ctrlKey||event.altKey||event.metaKey||!valid(event.code)){
        this.message('Chọn chữ cái, mũi tên, số, Space hoặc Shift. P và Esc được dành để tạm dừng.');return;
      }
      const {player,action}=this.capture,previous=this.players[player][action];
      let swapped=false;
      this.players.forEach((map,index)=>{
        for(const [other] of ACTIONS)if(map[other]===event.code&&(index!==player||other!==action)){
          map[other]=previous;swapped=true;
        }
      });
      this.players[player][action]=event.code;this.capture=null;this.preset='custom';
      this.save();this.render();
      this.message('Đã dùng '+label(event.code)+'. '+(swapped?'Hai phím đã đổi chỗ để tránh trùng.':'Bạn có thể tiếp tục đổi các phím khác.'));
      if(this.options.onChange)this.options.onChange();
    }
    setPreset(name){
      if(!PRESETS[name])return;
      this.players=copy(PRESETS[name]);this.preset=name;this.capture=null;
      this.save();this.render();this.message('Đã chọn bộ phím '+(name==='classic'?'A/D + J/K/L.':'Mũi tên + Z/X/C.'));
      if(this.options.onChange)this.options.onChange();
    }
    save(){
      try{localStorage.setItem(STORAGE,JSON.stringify({preset:this.preset,players:this.players}));}
      catch(_){this.storageAvailable=false;}
    }
    render(){
      this.buttons.forEach(({button,player,action})=>{
        const listening=!!this.capture&&this.capture.player===player&&this.capture.action===action;
        button.textContent=listening?'Nhấn phím…':this.keyLabel(action,player);
        button.classList.toggle('listening',listening);
      });
      document.querySelectorAll('[data-key-preset]').forEach(button=>{
        const active=button.dataset.keyPreset===this.preset;
        button.classList.toggle('selected',active);button.setAttribute('aria-pressed',String(active));
      });
      document.getElementById('bindingStorage').textContent=this.storageAvailable?
        'Bộ phím được nhớ trên trình duyệt này. Khi đấu online, mỗi người tự chọn phím của mình.':
        'Bộ phím áp dụng trong phiên này. Khi đấu online, mỗi người tự chọn phím của mình.';
    }
    message(text){document.getElementById('bindingMessage').textContent=text;}
  }
  RoosterControls.ACTIONS=ACTIONS;RoosterControls.label=label;
  root.RoosterControls=RoosterControls;
})(window);
