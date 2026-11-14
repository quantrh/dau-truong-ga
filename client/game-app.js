(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const canvas = $('gameCanvas'), ctx = canvas.getContext('2d', { alpha: false });
  const game = new RoosterGame({ mode: 'training' });
  const names = ['Gà Điều', 'Gà Trắng'];
  const keys = new Set();
  const touchHeld = new Set(), touchPointers = new Map(), touchCounts = new Map(), safariTouches = new Map();
  let lastTouchInputAt=0, lastPointerTouchAt=0;
  const directionPriority=['',''];
  const keyRepeatGrace=new Map(), directionTapBuffer=new Map();
  const KEY_REPEAT_GRACE_MS=140, DIRECTION_TAP_BUFFER_MS=95;
  const empty = () => ({left:false,right:false,jump:false,peck:false,kick:false,guard:false,dash:false});
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const images = { atlas: new Image(), background: new Image(), walk: new Image() };
  const sprites = window.ROOSTER_ASSETS.sprites;
  const walkSprites = window.ROOSTER_ASSETS.walkSprites;
  let loaded = false, selectedMode = 'training', playing = false, paused = false;
  let net = null, netEpoch = 0, onlineRole = null, disconnected = false;
  let remoteInput = empty(), lastRemoteInput = 0, lastState = 0;
  let inputSeq = 0, stateSeq = 0, lastInputSeq = -1, lastStateSeq = -1;
  let inputClock = 0, stateClock = 0, uiClock = 0, lastLogic = performance.now();
  let visual = game.state.fighters.map(f => ({x:f.x,y:f.y}));
  let particles = [], floating = [], shake = 0, seenEvent = 0;
  let resultShown = false, toastTimer = 0, isMuted = true, audio = null;
  // Pending miss sounds by fighter; must exist before any attack event is processed.
  const pendingAttackAudio = new Map();
  let rematchWanted = false, remoteRematchWanted = false, beforeHelpPaused = false, beforeControlsPaused = false;
  let activeCountdown = -1, lastFrame = performance.now();
  let roomRoster = null, networkHold = false, remoteFocused = true, remoteHostPaused = false;
  const tapKeys = ['jump','peck','kick','dash'];
  const freshActions = () => ({jump:0,peck:0,kick:0,dash:0});
  let localActions = freshActions(), remoteActions = freshActions(), remotePending = freshActions();
  let remoteRelease = {jump:false,dash:false};
  let observedRound = 1;
  const trainingSteps=['left','right','jump','peck','kick','guard','dash'];
  let trainingDone=new Set(),trainingLastX=640;
  let profileState=null,profileInitPromise=null;
  const inviteParams=new URLSearchParams(location.search);const invitedCode=(inviteParams.get('room')||'').trim().toUpperCase();
  let inviteAutoJoinStarted=false,onlineAutoCreating=false,onlineAutoJoining=false;
  function clearRemoteActions(){remotePending=freshActions();remoteRelease={jump:false,dash:false};}
  function receiveActions(raw){
    if(!raw||typeof raw!=='object')return;
    for(const a of tapKeys){
      const value=Number.isSafeInteger(raw[a])&&raw[a]>=0?raw[a]:0;
      if(value>remoteActions[a])remotePending[a]=Math.min(2,remotePending[a]+value-remoteActions[a]);
      remoteActions[a]=value;
    }
  }
  function remoteControls(){
    const input=cleanInput(remoteInput);
    for(const a of ['jump','dash']){
      if(remoteRelease[a]){input[a]=false;remoteRelease[a]=false;}
      else if(remotePending[a]>0){input[a]=true;remotePending[a]--;remoteRelease[a]=true;}
      else input[a]=false;
    }
    for(const a of ['peck','kick']){if(remotePending[a]>0){input[a]=true;remotePending[a]--;}}
    return input;
  }
  function sendInput(){
    if(net&&net.connected&&onlineRole==='guest'){
      const recentlyTouched=performance.now()-lastTouchInputAt<2500;
      net.send({type:'input',seq:++inputSeq,keys:inputFor(0),actions:{...localActions},focused:recentlyTouched||!document.hidden});
    }
  }
  function playerName(){
    const value=$('playerName').value.trim().normalize('NFC').slice(0,24);
    const rooster=profileRooster();
    const fallback=rooster&&rooster.name?rooster.name:'Người chơi';
    try{if(value)localStorage.setItem('rooster-player-name',value);}catch(_){}
    return value || fallback;
  }
  function shareURL(){
    const base=window.ROOSTER_PUBLIC_GAME_URL||(location.protocol==='http:'||location.protocol==='https:'?location.href:'https://quantrh.github.io/dau-truong-ga/');
    const u=new URL(base);u.search='';u.hash='';
    const build=window.ROOSTER_BUILD_ID||inviteParams.get('v')||'current';
    u.searchParams.set('v',build);
    u.searchParams.set('room',net?net.room:$('roomCode').textContent);
    return u.toString();
  }
  let hudState = '';
  const controls = new RoosterControls({
    onOpen(){
      beforeControlsPaused=paused;
      if(playing&&selectedMode!=='online')togglePause(true);
      releaseKeys();
    },
    onClose(){
      releaseKeys();
      if(playing&&selectedMode!=='online'&&!beforeControlsPaused)togglePause(false);
    },
    onChange(){releaseKeys();updateControlLabels();}
  });
  const ambient = Array.from({length:28}, (_,i) => ({x:(i*173+97)%1280,y:120+(i*67)%500,r:.6+(i%3)*.5,speed:4+(i%5)}));

  function profileRooster(){return profileState&&profileState.rooster?profileState.rooster:null;}
  function updateProfileUI(){
    const r=profileRooster();
    if(!$('profileState'))return;
    $('profileState').textContent=profileState&&profileState.ready?'Đã lưu':'Chưa kết nối';
    $('profileState').style.color=profileState&&profileState.ready?'#bfe49e':'#d5a879';
    if(r){
      if(document.activeElement!==$('roosterName'))$('roosterName').value=r.name;
      $('grainCount').textContent=String(r.grain);
      $('grasshopperCount').textContent=String(r.grasshopper);
      $('henCount').textContent=String(r.hen);
      $('powerValue').textContent=String(r.powerRating);
      if($('settingsSummary'))$('settingsSummary').textContent=r.name+' · P'+r.powerRating;
      if(!$('playerName').value.trim())$('playerName').placeholder='Mặc định: '+r.name;
    }else if($('settingsSummary'))$('settingsSummary').textContent='Power 100';
    updatePowerModeHint();
  }
  async function ensureProfile(){
    if(profileState&&profileState.ready)return profileState;
    if(profileInitPromise)return profileInitPromise;
    profileInitPromise=RoosterProfile.init(playerName()).then(state=>{
      profileState=state;updateProfileUI();
      // Profile/progression is optional; connectivity errors must never block gameplay.
      return state;
    }).finally(()=>{profileInitPromise=null;});
    return profileInitPromise;
  }
  function fallbackIdentity(){
    return {accessToken:'',roosterId:'',roosterName:playerName()+' · Chiến kê',powerRating:100};
  }
  async function profileIdentity(){
    const fallback=fallbackIdentity();
    const timeout=new Promise(resolve=>setTimeout(()=>resolve(null),1400));
    try{
      const state=await Promise.race([ensureProfile(),timeout]);
      if(!state||!state.ready)return fallback;
      const identity=await Promise.race([RoosterProfile.identity(),timeout]);
      return identity&&typeof identity==='object'?identity:fallback;
    }catch(_){
      return fallback;
    }
  }
  function currentPowerMode(){return $('powerMode')&&$('powerMode').value==='progression'?'progression':'balanced';}
  function updatePowerModeHint(){
    if(!$('powerModeHint'))return;
    const p=profileRooster()?profileRooster().powerRating:100;
    $('powerModeHint').textContent=currentPowerMode()==='progression'
      ?'Sức mạnh tích lũy: chiến kê của bạn dùng Power '+p+' (tối đa 130).'
      :'Cân bằng: cả hai chiến kê vào trận với Power 100.';
  }
  function applyLocalPowerRules(mode){
    if(mode==='training'){game.setMatchRules({powerMode:'balanced',powerRatings:[100,100]});return;}
    const power=profileRooster()?profileRooster().powerRating:100;
    game.setMatchRules({powerMode:currentPowerMode(),powerRatings:[power,100]});
  }
  function applyRoomPowerRules(room){
    if(!room)return;
    const host=room.host&&Number(room.host.powerRating)||100;
    const guest=room.guest&&Number(room.guest.powerRating)||100;
    const mode=room.matchMode==='progression'?'progression':'balanced';
    if($('powerMode')){$('powerMode').value=mode;$('powerMode').disabled=true;}
    game.setMatchRules({powerMode:mode,powerRatings:[host,guest]});
    updatePowerModeHint();
  }
  function resetTrainingProgress(){
    trainingDone=new Set();trainingLastX=game.state.fighters[0].x;
    updateTrainingUI();
  }
  function updateTrainingUI(){
    if(!$('trainingProgress'))return;
    $('trainingProgress').textContent=trainingDone.size+' / 7 động tác';
    const labels={left:'Sang trái',right:'Sang phải',jump:'Nhảy',peck:'Mổ',kick:'Đá',guard:'Giữ thế thủ',dash:'Lướt né'};
    document.querySelectorAll('[data-training]').forEach(el=>{const action=el.dataset.training;el.classList.toggle('done',trainingDone.has(action));el.textContent=(trainingDone.has(action)?'✓ ':'')+labels[action]+' · '+controls.keyLabel(action,0);});
    if(trainingDone.size===7)$('trainingProgress').textContent='7 / 7 động tác · Đã quen phím, tiếp tục tập tự do!';
  }
  function observeTraining(events,beforeX){
    if(selectedMode!=='training'||!playing)return;
    const f=game.state.fighters[0];
    if(f.x<beforeX-.5)trainingDone.add('left');
    if(f.x>beforeX+.5)trainingDone.add('right');
    if(f.guarding)trainingDone.add('guard');
    for(const event of events){
      if(event.fighter!==0)continue;
      if(event.type==='jump')trainingDone.add('jump');
      if(event.type==='dash')trainingDone.add('dash');
      if(event.type==='attack'&&event.kind==='peck')trainingDone.add('peck');
      if(event.type==='attack'&&event.kind==='kick')trainingDone.add('kick');
    }
    updateTrainingUI();
  }
  function fighterDisplayName(index){
    if(selectedMode==='online'&&roomRoster){
      const p=index===0?roomRoster.host:roomRoster.guest;
      return p?(p.roosterName||p.name):(index?'Gà Trắng':'Gà Điều');
    }
    if(index===0&&profileRooster())return profileRooster().name;
    return names[index];
  }
  function isSelfFighter(index){
    if(selectedMode==='training'||selectedMode==='bot')return index===0;
    if(selectedMode==='online')return onlineRole==='guest'?index===1:index===0;
    return false;
  }

  function toast(text) {
    $('toast').textContent = text;
    $('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4200);
  }
  function codeIsHeld(code){
    const now=performance.now();
    const repeatUntil=keyRepeatGrace.get(code)||0;
    const tapUntil=directionTapBuffer.get(code)||0;
    if(repeatUntil&&repeatUntil<=now)keyRepeatGrace.delete(code);
    if(tapUntil&&tapUntil<=now)directionTapBuffer.delete(code);
    return keys.has(code)||repeatUntil>now||tapUntil>now;
  }
  function directionIsHeld(index,action){
    const binding=controls.mapping(index)[action];
    return codeIsHeld(binding)||(index===0&&touchHeld.has(action));
  }
  function reconcileDirectionPriority(index){
    const preferred=directionPriority[index];
    if(preferred&&directionIsHeld(index,preferred))return;
    const other=preferred==='left'?'right':preferred==='right'?'left':'';
    if(other&&directionIsHeld(index,other)){directionPriority[index]=other;return;}
    if(directionIsHeld(index,'left'))directionPriority[index]='left';
    else if(directionIsHeld(index,'right'))directionPriority[index]='right';
    else directionPriority[index]='';
  }
  function inputFor(index) {
    const touchActive=index===0&&touchHeld.size>0;
    if (((document.hidden&&!touchActive) || $('helpDialog').open || controls.isOpen)) return empty();
    const input=controls.input(index,{has:code=>codeIsHeld(code)});
    if(index===0)for(const action of touchHeld)if(Object.prototype.hasOwnProperty.call(input,action))input[action]=true;
    reconcileDirectionPriority(index);
    if(input.left&&input.right){
      const preferred=directionPriority[index];
      input.left=preferred==='left';input.right=preferred==='right';
    }
    return input;
  }
  function controlsHint(player){
    const k=action=>controls.keyLabel(action,player);
    return k('left')+'/'+k('right')+' di chuyển · '+k('jump')+' nhảy · '+k('peck')+'/'+k('kick')+' ra đòn · '+k('guard')+' thủ · '+k('dash')+' lướt';
  }
  function updateControlLabels(){
    document.querySelectorAll('.controls-strip [data-key-action]').forEach(element=>{
      element.textContent=controls.keyLabel(element.dataset.keyAction,Number(element.dataset.player)||0);
    });
    $('p2Controls').textContent='NGƯỜI 2: '+controlsHint(1);
    if(playing)$('arenaHint').textContent=selectedMode==='local'?'Người 1: '+controlsHint(0):controlsHint(0);
  }
  function cleanInput(raw) {
    const out = empty();
    if (raw && typeof raw === 'object') Object.keys(out).forEach(k => { out[k] = raw[k] === true; });
    return out;
  }
  function unlockAudio() {
    if (isMuted) return;
    try {
      if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch (_) {}
  }
  function tone(freq, duration, gain, type, endFreq) {
    if (isMuted || !audio || audio.state !== 'running') return;
    try {
      const oscillator = audio.createOscillator(), volume = audio.createGain();
      const time = audio.currentTime;
      oscillator.type = type || 'sine';
      oscillator.frequency.setValueAtTime(freq, time);
      if (endFreq) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq), time + duration);
      volume.gain.setValueAtTime(0, time);
      volume.gain.linearRampToValueAtTime(gain, time + .008);
      volume.gain.exponentialRampToValueAtTime(.001, time + duration);
      oscillator.connect(volume); volume.connect(audio.destination);
      oscillator.start(time); oscillator.stop(time + duration + .02);
    } catch (_) {}
  }
  function noiseBurst(duration=.06,gain=.02,highpass=900){
    if(isMuted||!audio||audio.state!=='running')return;
    try{
      const frames=Math.max(1,Math.floor(audio.sampleRate*duration));
      const buffer=audio.createBuffer(1,frames,audio.sampleRate),data=buffer.getChannelData(0);
      for(let i=0;i<frames;i++)data[i]=(Math.random()*2-1)*(1-i/frames);
      const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),volume=audio.createGain();
      filter.type='highpass';filter.frequency.value=highpass;
      volume.gain.setValueAtTime(gain,audio.currentTime);volume.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);
      source.buffer=buffer;source.connect(filter);filter.connect(volume);volume.connect(audio.destination);source.start();
    }catch(_){}
  }
  function missSound(kind){
    if(kind==='kick'){noiseBurst(.11,.035,700);tone(180,.11,.025,'sawtooth',80);}
    else{noiseBurst(.07,.022,1200);tone(340,.07,.018,'triangle',190);}
  }
  function impactSound(event){
    const damage=Math.max(0,Number(event&&event.damage)||0),kind=event&&event.kind==='kick'?'kick':'peck';
    const heavy=damage>=18,medium=damage>=10;
    if(kind==='kick'){
      if(heavy){tone(92,.18,.16,'triangle',42);tone(210,.07,.055,'sawtooth',70);noiseBurst(.09,.05,350);}
      else if(medium){tone(118,.14,.11,'triangle',55);tone(260,.055,.035,'sawtooth',100);noiseBurst(.065,.032,500);}
      else{tone(155,.10,.075,'triangle',82);noiseBurst(.045,.02,800);}
    }else{
      if(heavy){tone(150,.12,.11,'triangle',68);tone(410,.04,.035,'square',180);noiseBurst(.055,.028,900);}
      else if(medium){tone(190,.10,.08,'triangle',95);tone(470,.035,.025,'square',220);noiseBurst(.04,.02,1100);}
      else{tone(245,.075,.055,'triangle',140);noiseBurst(.03,.014,1400);}
    }
    // Short hurt cry: heavier damage produces a lower, rougher vocal response.
    if(heavy){setTimeout(()=>{tone(kind==='kick'?235:285,.16,.045,'sawtooth',125);tone(kind==='kick'?330:390,.11,.02,'triangle',170);},20);}
    else if(medium){setTimeout(()=>tone(kind==='kick'?310:370,.11,.03,'sawtooth',190),18);}
    else setTimeout(()=>tone(kind==='kick'?410:465,.075,.018,'triangle',300),14);
  }
  function scheduleMiss(event){
    const fighter=Number(event&&event.fighter),kind=event&&event.kind==='kick'?'kick':'peck';
    if(!Number.isFinite(fighter))return;
    const old=pendingAttackAudio.get(fighter);if(old)clearTimeout(old.timer);
    const timer=setTimeout(()=>{const pending=pendingAttackAudio.get(fighter);if(pending&&pending.kind===kind){pendingAttackAudio.delete(fighter);missSound(kind);}},kind==='kick'?320:210);
    pendingAttackAudio.set(fighter,{kind,timer});
  }
  function resolveAttackAudio(event){
    const fighter=Number(event&&event.fighter),pending=pendingAttackAudio.get(fighter);
    if(pending){clearTimeout(pending.timer);pendingAttackAudio.delete(fighter);}
    impactSound(event);
  }
  function sound(event) {
    if (event === 'block') { tone(720,.07,.035,'triangle',310); noiseBurst(.035,.018,1800); }
    else if (event === 'jump') tone(180,.15,.02,'sine',410);
    else if (event === 'count') tone(510,.09,.04,'sine');
    else if (event === 'start') tone(780,.22,.05,'sine',1050);
    else if (event === 'win') {
      tone(523,.16,.045,'sine');
      setTimeout(() => tone(659,.17,.045,'sine'), 150);
      setTimeout(() => tone(784,.35,.05,'sine'), 300);
    }
  }
  function particlesAt(x,y,amount,kind) {
    if (reduced) amount = Math.min(amount,4);
    for (let i=0;i<amount;i++) {
      const angle = Math.random()*Math.PI*2, speed = 20+Math.random()*(kind==='hit'?210:70);
      particles.push({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed-(kind==='dust'?40:0),
        life:.25+Math.random()*.4,max:.7,r:kind==='dust'?2+Math.random()*5:1+Math.random()*3,
        color:kind==='block'?'#e5f5ce':kind==='hit'?'#fff2b4':'#d2b180',kind});
    }
    if (particles.length > 200) particles.splice(0,particles.length-200);
  }
  function effects(events) {
    if (!Array.isArray(events)) return;
    events.forEach(e => {
      if (!e || !Number.isFinite(e.id) || e.id <= seenEvent) return;
      seenEvent=e.id;
      if (e.type==='hit'||e.type==='block'||e.type==='guardBreak') {
        const x=Number.isFinite(e.x)?e.x:640, y=580-(Number.isFinite(e.y)?e.y:100);
        particlesAt(x,y,e.type==='hit'?18:11,e.type==='block'?'block':'hit');
        if(e.type==='block')sound('block');else resolveAttackAudio(e);
        if (!reduced) shake=e.type==='hit'?(e.kind==='kick'?(e.aerial?8:6.5):(e.aerial?4:3.2)):1.4;
        floating.push({x,y:y-35,life:.75,text:e.type==='guardBreak'?'VỠ THẾ THỦ':e.type==='block'?'ĐỠ':(e.aerial?'TRÚNG TRÊN KHÔNG · ':'')+Math.round(e.damage||0),color:e.type==='block'?'#e9f4d1':'#fff0bc'});
      } else if (e.type==='dash') {
        particlesAt(Number.isFinite(e.x)?e.x:640,575,17,'dust');
        tone(300,.13,.025,'sine',90);
      } else if (e.type==='jump'||e.type==='land') {
        particlesAt(Number.isFinite(e.x)?e.x:640,580,11,'dust');
        if(e.type==='jump')sound('jump');
      } else if(e.type==='attack') scheduleMiss(e);
      else if(e.type==='roundStart') sound('start');
      else if(e.type==='matchEnd') sound('win');
    });
  }
  function resetVisuals() {
    visual=game.state.fighters.map(f=>({x:f.x,y:f.y,lean:0,squash:0,foot:-1,lunge:0}));
    particles=[];floating=[];shake=0;seenEvent=0;activeCountdown=-1;hudState='';
    resultShown=false;rematchWanted=false;remoteRematchWanted=false;
    pendingAttackAudio.forEach(v=>clearTimeout(v.timer));pendingAttackAudio.clear();
    $('resultOverlay').hidden=true;$('rematchBtn').disabled=false;
    $('rematchBtn').textContent='Đấu lại ↻';
  }
  function setRoles() {
    const online=selectedMode==='online',training=selectedMode==='training';
    $('p0Role').textContent=online&&roomRoster?(roomRoster.host.roosterName||roomRoster.host.name)+(onlineRole==='host'?' · BẠN':''):online?(onlineRole==='guest'?'ĐỐI THỦ':'BẠN'):'BẠN';
    $('p1Role').textContent=online&&roomRoster&&roomRoster.guest?(roomRoster.guest.roosterName||roomRoster.guest.name)+(onlineRole==='guest'?' · BẠN':''):online?(onlineRole==='guest'?'BẠN':'ĐỐI THỦ'):selectedMode==='local'?'NGƯỜI 2':'MÁY';
    $('modeLabel').textContent=training?'TẬP MỘT MÌNH':online?'ĐẤU QUA MẠNG':selectedMode==='local'?'HAI NGƯỜI':'ĐẤU VỚI MÁY';
    $('p2Controls').hidden=selectedMode!=='local';
    const secondHud=$('p1Role').closest('.fighter-hud');if(secondHud)secondHud.style.visibility=training?'hidden':'';
    canvas.setAttribute('aria-label',training?'Một chú gà trong sân tập; dùng bàn phím để thử từng động tác':'Hai chú gà thi đấu trong đấu trường');
    $('startCaption').textContent=training?'Tập tự do, không giới hạn thời gian.':selectedMode==='local'?'Người 1: Gà Điều · Người 2: Gà Trắng.':'Bạn điều khiển Gà Điều ở bên trái.';
    updateControlLabels();
  }
  function releaseKeys() {
    keys.clear();keyRepeatGrace.clear();directionTapBuffer.clear();touchHeld.clear();touchPointers.clear();touchCounts.clear();safariTouches.clear();directionPriority[0]='';directionPriority[1]='';
    document.querySelectorAll('.touch-key.pressed').forEach(el=>el.classList.remove('pressed'));
    if (net && net.connected && onlineRole==='guest') {
      const recentlyTouched=performance.now()-lastTouchInputAt<2500;
      net.send({type:'input',seq:++inputSeq,keys:empty(),actions:{...localActions},focused:recentlyTouched||!document.hidden});
    }
  }
  function touchPress(element,event){
    const action=element&&element.dataset&&element.dataset.keyAction;
    if(!action||!Object.prototype.hasOwnProperty.call(empty(),action)||touchPointers.has(event.pointerId))return;
    event.preventDefault();
    lastTouchInputAt=performance.now();
    if(event.pointerType==='touch')lastPointerTouchAt=lastTouchInputAt;
    if(!playing||paused||disconnected||$('helpDialog').open||controls.isOpen)return;
    try{element.setPointerCapture(event.pointerId);}catch(_){}
    touchPointers.set(event.pointerId,{action,element});
    const count=(touchCounts.get(action)||0)+1;touchCounts.set(action,count);touchHeld.add(action);
    if(action==='left'||action==='right')directionPriority[0]=action;
    element.classList.add('pressed');element.setAttribute('aria-pressed','true');
    if(count===1&&tapKeys.includes(action))localActions[action]++;
    unlockAudio();sendInput();
  }
  function touchRelease(event){
    const active=touchPointers.get(event.pointerId);if(!active)return;
    event.preventDefault();lastTouchInputAt=performance.now();touchPointers.delete(event.pointerId);
    const count=Math.max(0,(touchCounts.get(active.action)||1)-1);
    if(count){touchCounts.set(active.action,count);}
    else{touchCounts.delete(active.action);touchHeld.delete(active.action);active.element.classList.remove('pressed');active.element.setAttribute('aria-pressed','false');}
    if(active.action==='left'||active.action==='right')reconcileDirectionPriority(0);
    sendInput();
  }
  function safariTouchStart(element,event){
    // iPhone Safari fallback for cases where Pointer Events do not reach the control pad.
    if(performance.now()-lastPointerTouchAt<80)return;
    const action=element&&element.dataset&&element.dataset.keyAction;
    if(!action||!Object.prototype.hasOwnProperty.call(empty(),action))return;
    event.preventDefault();
    if(!playing||paused||disconnected||$('helpDialog').open||controls.isOpen)return;
    lastTouchInputAt=performance.now();
    for(const touch of Array.from(event.changedTouches||[])){
      const id='touch-'+touch.identifier;
      if(safariTouches.has(id))continue;
      safariTouches.set(id,{action,element});
      const count=(touchCounts.get(action)||0)+1;touchCounts.set(action,count);touchHeld.add(action);
      if(action==='left'||action==='right')directionPriority[0]=action;
      element.classList.add('pressed');element.setAttribute('aria-pressed','true');
      if(count===1&&tapKeys.includes(action))localActions[action]++;
    }
    unlockAudio();sendInput();
  }
  function safariTouchEnd(event){
    if(performance.now()-lastPointerTouchAt<80)return;
    event.preventDefault();lastTouchInputAt=performance.now();
    for(const touch of Array.from(event.changedTouches||[])){
      const id='touch-'+touch.identifier,active=safariTouches.get(id);if(!active)continue;
      safariTouches.delete(id);
      const count=Math.max(0,(touchCounts.get(active.action)||1)-1);
      if(count)touchCounts.set(active.action,count);
      else{
        touchCounts.delete(active.action);touchHeld.delete(active.action);
        active.element.classList.remove('pressed');active.element.setAttribute('aria-pressed','false');
      }
      if(active.action==='left'||active.action==='right')reconcileDirectionPriority(0);
    }
    sendInput();
  }
  function setupTouchControls(){
    document.querySelectorAll('.touch-key[data-key-action]').forEach(element=>{
      element.setAttribute('aria-pressed','false');
      element.addEventListener('pointerdown',event=>touchPress(element,event));
      element.addEventListener('pointerup',touchRelease);
      element.addEventListener('pointercancel',touchRelease);
      element.addEventListener('lostpointercapture',touchRelease);
      element.addEventListener('touchstart',event=>safariTouchStart(element,event),{passive:false});
      element.addEventListener('touchend',safariTouchEnd,{passive:false});
      element.addEventListener('touchcancel',safariTouchEnd,{passive:false});
      element.addEventListener('contextmenu',event=>event.preventDefault());
    });
  }
  function closeNet() {
    ++netEpoch;
    const old=net;net=null;
    if(old)old.close();
    document.querySelector('.lobby').classList.remove('in-room');$('lobbyTitle').textContent='CHỌN CÁCH CHƠI';
    onlineRole=null;remoteInput=empty();lastRemoteInput=0;roomRoster=null;networkHold=false;remoteFocused=true;remoteHostPaused=false;clearRemoteActions();
    $('roomCard').hidden=true;$('leaveBtn').hidden=true;$('roomRoster').hidden=true;$('roomEntry').hidden=true;$('playerName').disabled=false;onlineAutoCreating=false;
    $('createBtn').disabled=false;$('joinBtn').disabled=false;$('roomInput').disabled=false;
    if($('powerMode'))$('powerMode').disabled=false;
    $('networkStatus').textContent='Tạo phòng hoặc nhập mã để kết nối.';
    $('networkStatus').classList.remove('error');
  }
  function lobby() {
    // Close result UI first so returning to the lobby is immediate even if later reset work fails.
    $('resultOverlay').hidden=true;resultShown=false;
    releaseKeys();closeNet();playing=false;paused=false;disconnected=false;document.body.classList.remove('combat-active');
    applyLocalPowerRules(selectedMode);game.reset(selectedMode);resetVisuals();setRoles();
    $('splash').style.display='';$('splash').hidden=false;$('sceneLabel').hidden=false;$('centerMessage').hidden=true;
    $('pauseBtn').hidden=true;if($('exitMatchBtn'))$('exitMatchBtn').hidden=true;if($('mobileGamepad'))$('mobileGamepad').hidden=true;if($('mobileQuickLaunch'))$('mobileQuickLaunch').hidden=false;
    const training=selectedMode==='training';
    $('arenaHint').textContent=training?'A/D di chuyển · Space nhảy · J/K ra đòn · L thủ · Shift trái lướt':'Sẵn sàng cho trận đấu đầu tiên?';
    $('footerState').textContent=training?'TẬP TỰ DO · THỂ LỰC VÔ HẠN':'TẠO PHÒNG · MỜI BẠN · VÀO SÂN';
    $('startBtn').textContent=loaded?(training?'BẮT ĐẦU TẬP →':'BẮT ĐẦU TRẬN →'):'Đang tải hình…';
    $('startBtn').disabled=!loaded;
    if(training)resetTrainingProgress();
    syncMobileQuickAction();updateHUD();
  }
  function syncMobileQuickAction(){
    const btn=$('mobilePrimaryBtn');if(!btn)return;
    document.querySelectorAll('[data-quick-mode]').forEach(chip=>{
      const active=chip.dataset.quickMode===selectedMode;
      chip.classList.toggle('selected',active);chip.setAttribute('aria-pressed',String(active));
    });
    if(playing){
      btn.textContent='TRẬN ĐANG DIỄN RA';btn.disabled=true;return;
    }
    if(!loaded){
      btn.textContent='Đang tải sân…';btn.disabled=true;return;
    }
    if(selectedMode!=='online'){
      btn.textContent=selectedMode==='training'?'BẮT ĐẦU TẬP →':'BẮT ĐẦU TRẬN →';btn.disabled=false;return;
    }
    if(!net||!roomRoster){
      if(RoosterNet.validCode(invitedCode)){
        btn.textContent=onlineAutoJoining?'ĐANG VÀO PHÒNG…':'THỬ VÀO PHÒNG LẠI →';
        btn.disabled=onlineAutoJoining;
      }else{
        btn.textContent=onlineAutoCreating?'ĐANG TẠO PHÒNG…':'THỬ TẠO PHÒNG →';
        btn.disabled=onlineAutoCreating;
      }
      return;
    }
    if(roomRoster.status==='playing'){
      btn.textContent='TRẬN ĐANG DIỄN RA';btn.disabled=true;return;
    }
    if(!roomRoster.guest){
      btn.textContent='CHIA SẺ LỜI MỜI →';btn.disabled=false;return;
    }
    const self=onlineRole==='guest'?roomRoster.guest:roomRoster.host;
    if(!self||!self.ready){
      btn.textContent='TÔI ĐÃ SẴN SÀNG →';btn.disabled=false;return;
    }
    if(onlineRole==='host'){
      const canStart=!!(roomRoster.host.ready&&roomRoster.host.online&&roomRoster.guest&&roomRoster.guest.ready&&roomRoster.guest.online);
      btn.textContent=canStart?'BẮT ĐẦU ONLINE →':'CHỜ ĐỐI THỦ SẴN SÀNG';
      btn.disabled=!canStart;return;
    }
    btn.textContent='ĐÃ SẴN SÀNG · CHỜ CHỦ PHÒNG';btn.disabled=true;
  }
  function selectMode(mode) {
    if(!['training','bot','local','online'].includes(mode))mode='training';
    const changed=mode!==selectedMode;
    selectedMode=mode;
    if(changed)lobby();
    document.querySelectorAll('.mode-card').forEach(button=>{
      const active=button.dataset.mode===mode;
      button.classList.toggle('selected',active);
      button.setAttribute('aria-pressed',String(active));
    });
    $('offlineOptions').hidden=mode==='online';$('onlineOptions').hidden=mode!=='online';
    if($('settingsMenu')){
      if(changed)$('settingsMenu').open=false;
      $('settingsMenu').hidden=mode==='online';
    }
    const lobbyTip=document.querySelector('.lobby > .tip-card');
    const lobbyFooter=document.querySelector('.lobby > .lobby-footer');
    if(lobbyTip)lobbyTip.hidden=mode==='online';
    if(lobbyFooter)lobbyFooter.hidden=mode==='online';
    if(mode==='online'){
      $('networkStatus').textContent=invitedCode?'Đang vào phòng từ link mời…':'Đang chuẩn bị phòng online…';
      $('networkStatus').classList.remove('error');
    }
    $('trainingCoach').hidden=mode!=='training';
    $('matchFacts').hidden=mode==='training';
    $('powerChoice').hidden=mode==='training';
    $('startCaption').textContent=mode==='training'?'Tập tự do, không giới hạn thời gian.':mode==='local'?'Hai người dùng chung bàn phím.':'Bạn điều khiển Gà Điều ở bên trái.';
    if(mode!=='online'&&$('powerMode'))$('powerMode').disabled=false;
    updatePowerModeHint();syncMobileQuickAction();
    if(mode==='online')maybeAutoHostOnline();
  }
  function beginGame(mode) {
    if(!loaded)return;
    ensureRenderLoop();
    playing=true;paused=false;disconnected=false;keys.clear();document.body.classList.add('combat-active');
    game.setDifficulty(mode==='bot'?'easy':'normal');
    if(mode!=='online')applyLocalPowerRules(mode);
    else if(roomRoster)applyRoomPowerRules(roomRoster);
    game.reset(mode);resetVisuals();localActions=freshActions();remoteActions=freshActions();clearRemoteActions();networkHold=false;remoteHostPaused=false;remoteFocused=true;observedRound=1;
    remoteInput=empty();lastRemoteInput=performance.now();lastState=performance.now();
    lastStateSeq=-1;lastInputSeq=-1;stateClock=0;inputClock=0;
    $('splash').hidden=true;$('splash').style.display='none';$('sceneLabel').hidden=true;
    $('pauseBtn').hidden=mode==='online';
    if($('mobileGamepad'))$('mobileGamepad').hidden=false;if($('mobileQuickLaunch'))$('mobileQuickLaunch').hidden=true;if($('exitMatchBtn'))$('exitMatchBtn').hidden=false;
    $('pauseBtn').textContent='II';
    $('startBtn').textContent=mode==='training'?'TẬP LẠI TỪ ĐẦU ↻':'CHƠI LẠI TỪ ĐẦU ↻';
    updateControlLabels();
    $('footerState').textContent=mode==='training'?'TẬP TỰ DO · THỂ LỰC VÔ HẠN':mode==='online'?'MỖI NGƯỜI ĐIỀU KHIỂN MỘT CON GÀ':'ESC / P ĐỂ TẠM DỪNG';
    if(mode==='training')resetTrainingProgress();
    setRoles();unlockAudio();updateHUD();
    const focusTarget=$('mobileGamepad')&&!$('mobileGamepad').hidden?document.querySelector('.arena-panel'):$('arena');
    requestAnimationFrame(()=>focusTarget.scrollIntoView({behavior:'auto',block:'start'}));
  }
  function showCenter(kicker,title,detail) {
    $('centerMessage').hidden=false;
    $('messageKicker').textContent=kicker;
    $('messageTitle').textContent=title;
    $('messageDetail').textContent=detail||'';
    if($('resumeBtn'))$('resumeBtn').hidden=!paused;
  }
  function togglePause(force) {
    if(!playing||selectedMode==='online'||game.state.phase==='matchEnd')return;
    paused=typeof force==='boolean'?force:!paused;
    hudState='';
    releaseKeys();
    $('pauseBtn').textContent=paused?'▶':'II';
    $('pauseBtn').setAttribute('aria-label',paused?'Tiếp tục trận đấu':'Tạm dừng');
    if($('resumeBtn'))$('resumeBtn').hidden=!paused;
    updateHUD();
  }
  function result() {
    if(resultShown)return;
    resultShown=true;
    const s=game.state, winner=s.matchWinner;
    const self=selectedMode==='online'&&onlineRole==='guest'?1:0;
    $('resultKicker').textContent=selectedMode==='local'?'NHÀ VÔ ĐỊCH SÂN ĐẤU':winner===self?'BẠN ĐÃ CHIẾN THẮNG':'TRẬN ĐẤU KHÉP LẠI';
    $('resultTitle').textContent=names[winner]+' chiến thắng';
    $('resultDetail').textContent='Tỉ số '+s.wins[0]+' – '+s.wins[1]+'. '+(winner===self?'Nhịp ra đòn rất tốt. Tiếp tục so tài?':'Giữ thể lực, chọn thời điểm và thử lại.');
    $('resultOverlay').hidden=false;$('centerMessage').hidden=true;$('pauseBtn').hidden=true;if($('exitMatchBtn'))$('exitMatchBtn').hidden=true;if($('mobileGamepad'))$('mobileGamepad').hidden=true;if($('mobileQuickLaunch'))$('mobileQuickLaunch').hidden=false;document.body.classList.remove('combat-active');syncMobileQuickAction();
    if(selectedMode==='online')setTimeout(()=>{RoosterProfile.refresh().then(()=>{profileState=RoosterProfile.state;updateProfileUI();}).catch(()=>{});},1800);
  }
  function updateHUD() {
    const s=game.state;
    s.fighters.forEach((f,i)=>{
      $('hp'+i).style.width=f.hp+'%';$('sp'+i).style.width=f.stamina+'%';
      $('hpText'+i).textContent=String(Math.ceil(f.hp));
      $('hp'+i).classList.toggle('danger',f.hp<=30);
      $('hp'+i).parentElement.setAttribute('aria-label','Máu '+names[i]+': '+Math.ceil(f.hp)+' trên 100');
      Array.from($('wins'+i).children).forEach((el,j)=>el.classList.toggle('won',j<s.wins[i]));
    });
    if(selectedMode==='training'){
      $('clock').textContent='∞';$('clock').style.color='';$('clock').setAttribute('aria-label','Không giới hạn thời gian');
      $('roundLabel').textContent='TẬP TỰ DO';
    }else{
      $('clock').textContent=String(Math.max(0,Math.ceil(s.roundTime))).padStart(2,'0');
      $('clock').style.color=s.roundTime<=10?'#ffca8e':'';
      $('roundLabel').textContent='HIỆP '+String(s.round).padStart(2,'0');
    }
    $('arena').dataset.phase=playing?s.phase:'lobby';
    if(!playing) {
      if(!disconnected)$('liveStatus').textContent=net?(roomRoster&&roomRoster.guest?'2 NGƯỜI · CHỜ BẮT ĐẦU':'CHỜ BẠN VÀO PHÒNG'):'SẴN SÀNG';
      return;
    }
    if(selectedMode==='online'&&net&&net.connected) {
      $('liveStatus').textContent='ONLINE · '+(net.ping===null?'ĐANG KẾT NỐI':net.ping+' MS');
    } else $('liveStatus').textContent=paused?'TẠM DỪNG':selectedMode==='training'?'TẬP MỘT MÌNH · THỂ LỰC VÔ HẠN':selectedMode==='local'?'2 NGƯỜI CÙNG MÁY':'ĐẤU VỚI MÁY';
    if(selectedMode==='online'&&networkHold&&!resultShown){showCenter('KẾT NỐI ĐANG CHẬM','Đợi tín hiệu đối thủ…',remoteHostPaused?'Chủ phòng đang tạm dừng đồng bộ.':'Chưa nhận được heartbeat mới từ máy đối thủ. Trận sẽ tự tiếp tục khi dữ liệu trở lại.');return;}
    if(paused) {showCenter('NGHỈ MỘT NHỊP','Tạm dừng','Nhấn P, Esc hoặc ▶ để tiếp tục');return;}
    if(selectedMode==='online'&&onlineRole==='guest'&&performance.now()-lastState>2000&&!resultShown) {
      showCenter('KẾT NỐI CHẬM','Đang chờ…','Chờ tín hiệu từ chủ phòng');return;
    }
    const signature=s.phase+':'+Math.ceil(s.phaseTime)+':'+s.round;
    if(signature===hudState&&s.phase!=='matchEnd')return;
    hudState=signature;
    if(s.phase==='countdown') {
      const n=Math.max(1,Math.ceil(s.phaseTime));
      showCenter('HIỆP '+s.round+' · SẴN SÀNG',String(n),'Giữ nhịp. Chờ thời điểm.');
      if(activeCountdown!==n){sound('count');activeCountdown=n;}
    } else if(s.phase==='fight') {
      $('centerMessage').hidden=true;if($('resumeBtn'))$('resumeBtn').hidden=true;activeCountdown=-1;
    } else if(s.phase==='roundEnd') {
      showCenter(s.roundWinner<0?'HIỆP ĐẤU HÒA':'KẾT THÚC HIỆP '+s.round,s.roundWinner<0?'Hòa!':names[s.roundWinner]+' thắng',s.roundWinner<0?'Đấu lại hiệp, không tính điểm.':'Tỉ số '+s.wins[0]+' – '+s.wins[1]+' · Chuẩn bị hiệp tiếp theo');
      $('messageTitle').style.fontSize='clamp(24px,4vw,56px)';
    } else if(s.phase==='matchEnd')result();
    if(s.phase!=='roundEnd')$('messageTitle').style.fontSize='';
  }
  function markDisconnected(message) {
    if(disconnected)return;
    disconnected=true;playing=false;releaseKeys();if($('exitMatchBtn'))$('exitMatchBtn').hidden=true;if($('mobileGamepad'))$('mobileGamepad').hidden=true;if($('mobileQuickLaunch'))$('mobileQuickLaunch').hidden=false;document.body.classList.remove('combat-active');syncMobileQuickAction();
    $('roomRoster').hidden=true;$('roomCard').hidden=true;$('roomActions').hidden=true;$('leaveBtn').hidden=false;
    $('centerMessage').hidden=true;$('splash').hidden=true;$('pauseBtn').hidden=true;
    $('resultKicker').textContent='KẾT NỐI ĐÃ DỪNG';
    $('resultTitle').textContent='Đối thủ đã rời sân';
    $('resultDetail').textContent=message||'Hãy tạo phòng mới để tiếp tục.';
    $('resultOverlay').hidden=false;$('rematchBtn').textContent='Về ghép phòng';
    $('rematchBtn').disabled=false;$('liveStatus').textContent='MẤT KẾT NỐI';
    $('footerState').textContent='TRẬN ĐẤU ĐÃ DỪNG · KHÔNG TÍNH THẮNG THUA';
  }
  function renderRoom(room){
    roomRoster=room;onlineRole=net?net.role:onlineRole;
    applyRoomPowerRules(room);
    document.querySelector('.lobby').classList.add('in-room');$('lobbyTitle').textContent='PHÒNG CHƠI ONLINE';
    const self=onlineRole==='guest'?room.guest:room.host;
    $('roomRoster').hidden=false;$('roomCard').hidden=false;
    $('roomCode').textContent=room.code;$('roomCount').textContent=room.guest?'2 / 2':'1 / 2';
    const invite=shareURL();if($('inviteLink')){$('inviteLink').textContent=invite;$('inviteLink').href=invite;}
    onlineAutoCreating=false;
    $('hostName').textContent=(room.host.roosterName||room.host.name)+' · P'+(room.host.powerRating||100)+(onlineRole==='host'?' (bạn)':'');
    $('guestName').textContent=room.guest?(room.guest.roosterName||room.guest.name)+' · P'+(room.guest.powerRating||100)+(onlineRole==='guest'?' (bạn)':''):'Đang chờ bạn…';
    for(const role of ['host','guest']){
      const player=room[role],chip=$(role+'Ready');
      chip.textContent=!player?'—':!player.online?'Kết nối…':room.status==='playing'?'Trong trận':player.ready?'Sẵn sàng':'Chưa sẵn sàng';
      chip.classList.toggle('ready',!!player&&player.online&&(player.ready||room.status==='playing'));
      chip.classList.toggle('away',!!player&&!player.online);
    }
    $('roomActions').hidden=room.status==='playing';
    $('readyBtn').textContent=self&&self.ready?'✓ Đã sẵn sàng · Hủy':'Tôi đã sẵn sàng';
    $('readyBtn').setAttribute('aria-pressed',String(!!self&&self.ready));
    $('readyBtn').disabled=!room.guest||room.status!=='waiting';
    $('launchBtn').hidden=onlineRole!=='host';
    $('launchBtn').disabled=!(room.host.ready&&room.host.online&&room.guest&&room.guest.ready&&room.guest.online&&room.status==='waiting');
    $('readyHint').textContent=room.status==='playing'?'Bạn điều khiển '+(onlineRole==='host'?'Gà Điều.':'Gà Trắng.'):!room.guest?'Gửi mã hoặc link mời. Bạn của bạn sẽ xuất hiện ở đây.':room.host.ready&&room.guest.ready?(onlineRole==='host'?'Cả hai đã sẵn sàng. Bạn có thể bắt đầu trận.':'Cả hai đã sẵn sàng. Chờ chủ phòng bắt đầu.'):'Hai người cùng bấm sẵn sàng để vào sân.';
    $('roomHint').textContent=room.guest?'Bạn của bạn đã vào phòng.': 'Gửi mã hoặc link này cho bạn của bạn.';
    setRoles();syncMobileQuickAction();
  }
  function resetNetworkTransportOnly(){
    ++netEpoch;
    const old=net;net=null;
    if(old)old.close();
    onlineRole=null;roomRoster=null;networkHold=false;remoteFocused=true;remoteHostPaused=false;
    remoteInput=empty();lastRemoteInput=0;clearRemoteActions();
  }
  function createNetwork(preserveUI=false) {
    if(preserveUI)resetNetworkTransportOnly();else closeNet();
    const epoch=netEpoch;
    const options={
      requestTimeout:5000,
      forceRelay:true,
      onStatus(status){
        if(epoch!==netEpoch)return;
        $('networkStatus').textContent=status.message;
        $('networkStatus').classList.toggle('error',status.state==='error'||status.state==='disconnected');
        const busy=['connecting','hosting','joining','connected','waiting','reconnecting'].includes(status.state);
        $('createBtn').disabled=busy;$('joinBtn').disabled=busy;$('roomInput').disabled=busy;$('playerName').disabled=busy;
        $('leaveBtn').hidden=!busy;
        if(status.room&&busy){$('roomCard').hidden=false;$('roomCode').textContent=status.room;}
        if(['error','disconnected'].includes(status.state)&&!playing){$('roomCard').hidden=true;$('roomRoster').hidden=true;}
        syncMobileQuickAction();
      },
      onLobby(room){if(epoch===netEpoch)renderRoom(room);},
      onConnect(info){
        if(epoch!==netEpoch)return;
        onlineRole=info.role;lastState=performance.now();
        if(roomRoster)applyRoomPowerRules(roomRoster);
        beginGame('online');
        if(info.role==='host')net.send({type:'start',state:game.snapshot(),seq:++stateSeq,paused:false});
        else showCenter('ĐÃ KẾT NỐI','Sẵn sàng','Đang nhận trận đấu từ chủ phòng');
        toast(info.role==='host'?'Trận bắt đầu. Bạn điều khiển Gà Điều.':'Bạn điều khiển Gà Trắng bằng bộ phím Bạn / Người 1.');
      },
      onData(packet){
        if(epoch!==netEpoch||!packet)return;
        if(onlineRole==='host'&&packet.type==='input'){
          if(!Number.isFinite(packet.seq)||packet.seq<=lastInputSeq)return;
          lastInputSeq=packet.seq;remoteInput=cleanInput(packet.keys);receiveActions(packet.actions);remoteFocused=packet.focused!==false;lastRemoteInput=performance.now();
        } else if(onlineRole==='guest'&&(packet.type==='state'||packet.type==='start')){
          if(Number.isFinite(packet.seq)&&packet.seq<=lastStateSeq&&packet.type!=='start')return;
          if(game.loadSnapshot(packet.state)){
            if(Number.isFinite(packet.seq))lastStateSeq=packet.seq;
            if(packet.type==='start'){
              playing=true;disconnected=false;paused=false;resetVisuals();keys.clear();localActions=freshActions();
            }
            remoteHostPaused=packet.paused===true;
            lastState=performance.now();effects(game.state.recentEvents);hudState='';
            if(!playing&&!disconnected){playing=true;resetVisuals();}
          }
        } else if(packet.type==='rematch-request'&&game.state.phase==='matchEnd'){
          remoteRematchWanted=true;
          if(rematchWanted&&onlineRole==='host')startRematch();
          else if(!rematchWanted)toast('Đối thủ muốn đấu lại. Nhấn “Đấu lại” để đồng ý.');
        }
      },
      onDisconnect(message){if(epoch===netEpoch)markDisconnected(message);}
    };
    net=new RoosterNet(options);
    return net;
  }
  function createDirectNetwork(preserveUI=false){
    if(preserveUI)resetNetworkTransportOnly();else closeNet();
    const epoch=netEpoch;
    const options={
      onStatus(status){
        if(epoch!==netEpoch)return;
        $('networkStatus').textContent=status.message;
        $('networkStatus').classList.toggle('error',status.state==='error'||status.state==='disconnected');
        syncMobileQuickAction();
      },
      onLobby(room){if(epoch===netEpoch)renderRoom(room);},
      onConnect(info){
        if(epoch!==netEpoch)return;
        onlineRole=info.role;lastState=performance.now();
        if(roomRoster)applyRoomPowerRules(roomRoster);
        beginGame('online');
        if(info.role==='host')net.send({type:'start',state:game.snapshot(),seq:++stateSeq,paused:false});
        else showCenter('ĐÃ KẾT NỐI','Sẵn sàng','Đang nhận trận đấu từ chủ phòng');
      },
      onData(packet){
        if(epoch!==netEpoch||!packet)return;
        if(onlineRole==='host'&&packet.type==='input'){
          if(!Number.isFinite(packet.seq)||packet.seq<=lastInputSeq)return;
          lastInputSeq=packet.seq;remoteInput=cleanInput(packet.keys);receiveActions(packet.actions);remoteFocused=packet.focused!==false;lastRemoteInput=performance.now();
        } else if(onlineRole==='guest'&&(packet.type==='state'||packet.type==='start')){
          if(Number.isFinite(packet.seq)&&packet.seq<=lastStateSeq&&packet.type!=='start')return;
          if(game.loadSnapshot(packet.state)){
            if(Number.isFinite(packet.seq))lastStateSeq=packet.seq;
            if(packet.type==='start'){playing=true;disconnected=false;paused=false;resetVisuals();keys.clear();localActions=freshActions();}
            remoteHostPaused=packet.paused===true;lastState=performance.now();effects(game.state.recentEvents);hudState='';
            if(!playing&&!disconnected){playing=true;resetVisuals();}
          }
        } else if(packet.type==='rematch-request'&&game.state.phase==='matchEnd'){
          remoteRematchWanted=true;if(rematchWanted&&onlineRole==='host')startRematch();
        }
      },
      onDisconnect(message){if(epoch===netEpoch)markDisconnected(message);}
    };
    net=new DirectPeerRoom(options);
    return net;
  }
  async function hostRoom(){
    if(!loaded||onlineAutoCreating||roomRoster)return;
    onlineAutoCreating=true;
    playing=false;disconnected=false;
    $('networkStatus').textContent='Đang tạo phòng online…';$('networkStatus').classList.remove('error');
    syncMobileQuickAction();

    const identity=fallbackIdentity();
    const withTimeout=(promise,ms,label)=>Promise.race([
      promise,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))
    ]);

    let success=false;
    let lastError=null;
    try{
      // Primary path: Supabase room relay. RoosterNet may upgrade to direct P2P,
      // but gameplay keeps working through relay when mobile NAT blocks WebRTC.
      let current=createNetwork();
      onlineAutoCreating=true;syncMobileQuickAction();
      try{
        await withTimeout(current.create(playerName(),{
          accessToken:identity.accessToken,
          roosterId:identity.roosterId,
          matchMode:currentPowerMode()
        }),8500,'Máy chủ phòng không phản hồi.');
        success=true;
        return;
      }catch(error){
        lastError=error;
      }

      // Last-resort fallback: direct PeerJS room.
      $('networkStatus').textContent='Máy chủ phòng chậm · đang thử kết nối trực tiếp…';$('networkStatus').classList.remove('error');
      current=createDirectNetwork();
      onlineAutoCreating=true;syncMobileQuickAction();
      try{
        await withTimeout(current.create(playerName(),{
          roosterName:identity.roosterName,
          powerRating:identity.powerRating,
          matchMode:currentPowerMode()
        }),7500,'Kết nối trực tiếp không phản hồi.');
        success=true;
        return;
      }catch(error){
        lastError=error;
      }
    }catch(error){
      lastError=error;
    }finally{
      onlineAutoCreating=false;
      if(!success&&!roomRoster){
        closeNet();
        $('networkStatus').textContent=(lastError&&lastError.message?lastError.message:'Không tạo được phòng.')+' Bấm thử lại.';
        $('networkStatus').classList.add('error');
      }
      syncMobileQuickAction();
    }
  }
  function maybeAutoHostOnline(){
    if(selectedMode!=='online'||RoosterNet.validCode(invitedCode)||!loaded||net||roomRoster||onlineAutoCreating)return;
    hostRoom();
  }
  async function joinRoomCode(code,auto=false){
    code=String(code||'').trim().toUpperCase();
    if(!loaded){if(!auto)toast('Chờ hình ảnh tải xong rồi vào phòng.');return false;}
    if(!RoosterNet.validCode(code)){if(!auto)toast('Nhập đúng mã phòng 6 ký tự.');return false;}
    onlineAutoJoining=true;syncMobileQuickAction();
    playing=false;disconnected=false;
    if(auto){
      $('roomEntry').hidden=true;
      $('networkStatus').textContent='Đang tự động vào phòng '+code+' từ link mời…';
      $('networkStatus').classList.remove('error');
    }
    let current=null;
    let lastError=null;
    try{
      // Invite links always try the Supabase relay first. Old links may still
      // contain transport=peer, but that hint is intentionally ignored.
      const identity=fallbackIdentity();
      try{
        current=createNetwork(true);
        await current.join(code,playerName(),{roosterName:identity.roosterName,powerRating:identity.powerRating});
        // Network join is authoritative. UI cleanup must never turn a successful
        // /join into a fallback attempt that closes the just-joined room.
        try{releaseKeys();}catch(_){}
        try{resetVisuals();}catch(_){}
        return true;
      }catch(error){
        lastError=error;
      }
      try{
        $('networkStatus').textContent='Máy chủ phòng chưa nhận được link · đang thử P2P trực tiếp…';$('networkStatus').classList.remove('error');
        current=createDirectNetwork(true);
        await current.join(code,playerName(),{roosterName:identity.roosterName,powerRating:identity.powerRating});
        try{releaseKeys();}catch(_){}
        try{resetVisuals();}catch(_){}
        return true;
      }catch(error){
        lastError=error;
      }
      $('networkStatus').textContent=(lastError&&lastError.message?lastError.message:'Không vào được phòng.')+' Nhờ chủ phòng gửi link mới.';
      $('networkStatus').classList.add('error');
      if(auto)$('roomEntry').hidden=true;
      return false;
    }finally{
      onlineAutoJoining=false;
      syncMobileQuickAction();
    }
  }
  async function joinRoom(event){
    event.preventDefault();
    return joinRoomCode($('roomInput').value,false);
  }
  function maybeAutoJoinInvite(){
    if(inviteAutoJoinStarted||onlineAutoJoining||!loaded||!RoosterNet.validCode(invitedCode))return;
    inviteAutoJoinStarted=true;
    joinRoomCode(invitedCode,true).then(ok=>{
      if(!ok)inviteAutoJoinStarted=false;
    }).catch(()=>{
      inviteAutoJoinStarted=false;
      onlineAutoJoining=false;
      syncMobileQuickAction();
    });
  }
  async function shareInvite(){
    if(!net||!roomRoster)return;
    const url=shareURL();
    try{
      if(navigator.share){await navigator.share({title:'Đấu Trường Gà',text:'Vào phòng đấu với tôi:',url});return;}
      await navigator.clipboard.writeText(url);toast('Đã chép link mời. Gửi link này cho bạn.');
    }catch(error){
      if(error&&error.name==='AbortError')return;
      try{await navigator.clipboard.writeText(url);toast('Đã chép link mời. Gửi link này cho bạn.');}
      catch(_){toast('Không thể mở chia sẻ. Hãy giữ vào link mời để sao chép.');}
    }
  }
  function startRematch(){
    beginGame(selectedMode);
    if(selectedMode==='online'&&onlineRole==='host')net.send({type:'start',seq:++stateSeq,state:game.snapshot(),paused:false});
  }
  function requestRematch(){
    if(disconnected){lobby();return;}
    if(selectedMode!=='online'){startRematch();return;}
    if(!net||!net.connected){lobby();return;}
    rematchWanted=true;net.send({type:'rematch-request'});
    if(remoteRematchWanted&&onlineRole==='host'){startRematch();return;}
    $('rematchBtn').textContent='Đợi đối thủ…';$('rematchBtn').disabled=true;
  }

  function drawRooster(f,index,time,dt) {
    const v=visual[index], ground=580, color=index?'silver':'gold';
    if(playing&&onlineRole==='guest'){
      const smooth=1-Math.exp(-24*dt);v.x+=(f.x-v.x)*smooth;v.y+=(f.y-v.y)*smooth;
    }else{v.x=f.x;v.y=f.y;}
    let x=v.x, altitude=v.y;
    if(!playing&&!disconnected){x=index?965:315;altitude=0;}
    const moving=f.action==='walk'&&f.y<2;
    const phase=Number.isFinite(f.gaitPhase)?f.gaitPhase:time*10;
    const moveBlend=Number.isFinite(f.moveBlend)?f.moveBlend:Math.min(1,Math.abs(f.vx)/310);
    const reverse=f.vx*f.facing<0;
    const phaseIndex=Math.floor(((phase/(Math.PI*2))%1)*4)%4;
    const frame=reverse?(4-phaseIndex)%4:phaseIndex;
    let pose='idle', source=images.atlas, scale=.635;
    const airborne=playing&&f.y>12;
    let airAttack=null,airAttackPower=0;
    let lift=0,lunge=0,lean=(f.vx/310)*f.facing*.045;
    let squash=f.action==='guard'?.11:0;
    let bob=moving?Math.abs(Math.sin(phase*2))*3*moveBlend:Math.sin(time*2.4+index)*.8;
    if(f.action==='peck'){
      const progress=Math.min(1,f.attackTimer/.43),arc=Math.sin(progress*Math.PI);
      pose=progress>.15&&progress<.86?'peck':'idle';
      if(airborne){
        airAttack='peck';airAttackPower=arc;
        lunge=arc*34;lean-=arc*.22;squash-=arc*.035;lift+=arc*11;
      }else{
        lunge=arc*16;squash+=arc*.035;
      }
    }else if(f.action==='kick'){
      const progress=Math.min(1,f.attackTimer/.7),arc=Math.sin(progress*Math.PI);
      pose=progress>.14&&progress<.88?'kick':'idle';
      if(airborne){
        airAttack='kick';airAttackPower=arc;
        lift=arc*50;lean-=arc*.26;lunge=arc*34;squash-=arc*.06;
      }else{
        lift=arc*37;lean-=arc*.065;lunge=arc*18;
        if(progress<.2)squash+=Math.sin(progress/.2*Math.PI)*.09;
      }
    }else if(f.action==='jump'){
      pose='kick';lean=-Math.max(-.07,Math.min(.09,f.vy/650*.075));
      bob+=Math.sin(time*19)*1.6;
    }else if(f.action==='dash'){
      const dodgePhase=Math.min(1,Math.max(0,f.dashTimer/.28));
      const crouch=Math.sin(Math.min(1,(1-dodgePhase)*1.9)*Math.PI);
      pose='idle';
      // Dodge is a low ducking slide: compress the body, lower the center of mass
      // and tuck the neck/head instead of only translating backward.
      squash=.26+.08*crouch;
      lean=f.dashDirection*f.facing*.11;
      bob=-18-10*crouch;
      lift-=4*crouch;
      lunge-=f.dashDirection*5;
      scale*=.96;
    }else if(f.action==='hurt'){
      const impact=Math.min(1,Math.max(.18,f.hurtTimer/.36));
      const recoil=Math.min(1,Math.abs(f.vx)/430);
      lean=-.14-.17*impact;squash=-.035-.05*impact;bob=-3-5*impact;
      lunge-=Math.min(24,8+recoil*18);
      lift+=Math.max(0,Math.min(16,f.y*.08));
    }else if(f.action==='win')bob=Math.abs(Math.sin(time*4))*7;
    if(f.landTimer>0)squash+=.1*Math.sin(Math.min(1,f.landTimer/.16)*Math.PI);
    const ease=1-Math.exp(-24*dt);
    v.lean=(v.lean||0)+(lean-(v.lean||0))*ease;
    v.squash=(v.squash||0)+(squash-(v.squash||0))*ease;
    v.lunge=(v.lunge||0)+(lunge-(v.lunge||0))*(1-Math.exp(-35*dt));
    if(v.face!==f.facing){v.face=f.facing;v.turn=.09;}
    v.turn=Math.max(0,(v.turn||0)-dt);
    let sprite=sprites[color][pose];
    if(moving){
      sprite=walkSprites[color]['walk'+frame];source=images.walk;scale*=walkSprites.scaleMultiplier||1.1;
      if(v.foot!==phaseIndex&&phaseIndex%2===0&&playing&&!paused&&Math.abs(f.vx)>110){
        particlesAt(x,ground,3,'dust');
      }
      v.foot=phaseIndex;
    }else v.foot=-1;
    altitude+=lift;
    ctx.save();
    const shadowScale=Math.max(.35,1-altitude/340);
    ctx.translate(x,ground+2);ctx.scale(shadowScale,shadowScale);
    const shadow=ctx.createRadialGradient(0,0,8,0,0,90);
    shadow.addColorStop(0,'rgba(37,25,10,.46)');shadow.addColorStop(.55,'rgba(39,26,11,.24)');shadow.addColorStop(1,'rgba(39,26,11,0)');
    ctx.scale(1,.22);ctx.fillStyle=shadow;ctx.beginPath();ctx.arc(0,0,95,0,Math.PI*2);ctx.fill();ctx.restore();
    if(playing){
      ctx.save();ctx.strokeStyle=index?'rgba(221,237,216,.5)':'rgba(255,215,139,.55)';
      ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(x,ground+4,43,9,0,0,Math.PI*2);ctx.stroke();ctx.restore();
    }
    ctx.save();ctx.translate(x+v.lunge*f.facing,ground-altitude-bob);ctx.scale(f.facing,1);
    ctx.rotate(v.lean);
    const dashCrouch=f.action==='dash'?1:0;
    ctx.scale(1+v.squash*.3-Math.sin(v.turn/.09*Math.PI)*.07+(dashCrouch*.05),1-v.squash-(dashCrouch*.10));
    const draw=()=>{
      if(source&&source.naturalWidth&&sprite&&sprite.w>0&&sprite.h>0){
        ctx.drawImage(source,sprite.x,sprite.y,sprite.w,sprite.h,-sprite.anchorX*scale,-sprite.anchorY*scale,sprite.w*scale,sprite.h*scale);
        return;
      }
      // Safari/iOS fallback while an image atlas is unavailable: keep both fighters visible.
      ctx.save();
      ctx.fillStyle=index?'#d9ddd6':'#9f4f24';
      ctx.beginPath();ctx.ellipse(-8,-105,54,76,-.18,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=index?'#e8ece7':'#d27a31';
      ctx.beginPath();ctx.arc(26,-165,27,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#c53b30';ctx.beginPath();ctx.arc(31,-188,12,0,Math.PI*2);ctx.fill();
      ctx.fillStyle='#d6a13e';ctx.beginPath();ctx.moveTo(51,-168);ctx.lineTo(76,-160);ctx.lineTo(51,-151);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#332716';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(-16,-35);ctx.lineTo(-26,8);ctx.moveTo(10,-35);ctx.lineTo(18,8);ctx.stroke();
      ctx.restore();
    };
    if(f.dashTimer>0&&!reduced){
      for(let trail=2;trail>0;trail--){
        ctx.save();ctx.globalAlpha=.045*(3-trail);ctx.translate(-f.dashDirection*f.facing*trail*19,0);draw();ctx.restore();
      }
    }
    if(airAttack&&airAttackPower>.12&&!reduced){
      ctx.save();ctx.globalAlpha=.12*airAttackPower;ctx.strokeStyle=airAttack==='kick'?'#fff0a8':'#f4d78e';ctx.lineWidth=5;
      ctx.beginPath();ctx.arc(-18,-112,76,-.9,.55);ctx.stroke();ctx.restore();
    }
    if(f.hitFlash>0)ctx.filter='brightness('+(1+f.hitFlash*1.7)+')';
    else if(f.invulnTimer>0)ctx.filter='brightness(1.1)';
    draw();ctx.filter='none';
    if(f.guarding&&playing){
      ctx.strokeStyle='rgba(224,240,193,.6)';ctx.lineWidth=2.5;
      ctx.beginPath();ctx.ellipse(38,-112,55,91,-.08,-1.3,1.2);ctx.stroke();
      ctx.strokeStyle='rgba(248,230,164,.17)';ctx.lineWidth=8;ctx.stroke();
    }
    ctx.restore();
    if(playing&&f.stamina<15&&f.hp>0&&selectedMode!=='training'){
      ctx.fillStyle='#fff1c8';ctx.font='600 12px "Noto Sans Game"';ctx.textAlign='center';ctx.letterSpacing='0px';ctx.fillText('HỒI THỂ LỰC',x,ground-altitude-282);
    }
    if(playing&&(selectedMode!=='training'||index===0)){
      const close=selectedMode!=='training'&&Math.abs(game.state.fighters[0].x-game.state.fighters[1].x)<185;
      const labelY=ground-altitude-248-(close&&index===1?28:0);
      const label=fighterDisplayName(index);
      const power=game.state.matchRules&&game.state.matchRules.powerMode==='progression'?' · P'+Math.round(f.powerRating||100):'';
      ctx.save();ctx.textAlign='center';ctx.letterSpacing='0px';
      ctx.font='700 13px "Noto Sans Game"';
      const width=Math.max(76,ctx.measureText(label+power).width+26);
      ctx.fillStyle='rgba(20,24,16,.78)';ctx.strokeStyle=index?'rgba(190,224,213,.62)':'rgba(238,195,111,.68)';ctx.lineWidth=1.5;
      ctx.beginPath();ctx.roundRect(x-width/2,labelY-18,width,27,8);ctx.fill();ctx.stroke();
      ctx.fillStyle='#fff3d5';ctx.shadowColor='#111';ctx.shadowBlur=5;ctx.fillText(label+power,x,labelY);ctx.shadowBlur=0;
      if(isSelfFighter(index)){ctx.font='700 8px "Noto Sans Game"';ctx.fillStyle='#d8efac';ctx.fillText('BẠN',x,labelY+20);}
      ctx.restore();
    }
    if(!playing&&!disconnected){
      ctx.save();ctx.font='600 13px "Noto Sans Game"';ctx.textAlign='center';ctx.letterSpacing='0px';
      ctx.fillStyle='#fff2cf';ctx.shadowColor='#352a0a';ctx.shadowBlur=8;
      ctx.fillText(roomRoster?(index?(roomRoster.guest?roomRoster.guest.name:'Đang chờ bạn…'):roomRoster.host.name):(index?'GÀ TRẮNG':'GÀ ĐIỀU'),x,ground+45);ctx.restore();
    }
  }
  let renderErrorLogged=false,renderStarted=false;
  function ensureRenderLoop(){
    if(renderStarted)return;
    renderStarted=true;
    requestAnimationFrame(render);
  }
  function render(now) {
    const dt=Math.min(.05,Math.max(0,(now-lastFrame)/1000));lastFrame=now;
    try{
      if(loaded){
        const time=now/1000;
        ctx.save();ctx.clearRect(0,0,1280,720);
        if(shake>.1){ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake);shake*=Math.exp(-17*dt);}
        try{
          if(images.background&&images.background.naturalWidth)ctx.drawImage(images.background,0,0,1280,720);
          else throw new Error('background not ready');
        }catch(_){
          ctx.fillStyle='#4b4938';ctx.fillRect(0,0,1280,720);
        }
      ctx.fillStyle='rgba(46,38,14,.045)';ctx.fillRect(0,0,1280,720);
      ambient.forEach(d=>{
        const x=(d.x+time*d.speed)%1280,y=d.y+Math.sin(time*.25+d.x)*15;
        ctx.fillStyle='rgba(255,235,173,.23)';ctx.beginPath();ctx.arc(x,y,d.r,0,Math.PI*2);ctx.fill();
      });
      game.state.fighters.forEach((f,i)=>{if(selectedMode!=='training'||i===0)drawRooster(f,i,time,dt);});
      particles=particles.filter(p=>p.life>0);
      particles.forEach(p=>{
        p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.kind==='dust'?-15:180;
        ctx.globalAlpha=Math.max(0,p.life/p.max)*.75;ctx.fillStyle=p.color;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
      });ctx.globalAlpha=1;
      floating=floating.filter(f=>f.life>0);
      floating.forEach(f=>{
        f.life-=dt;f.y-=35*dt;ctx.globalAlpha=Math.max(0,Math.min(1,f.life*2));ctx.fillStyle=f.color;
        ctx.font='bold '+(f.text.length>3?15:24)+'px "Noto Sans Game"';ctx.textAlign='center';
        ctx.shadowColor='#33270c';ctx.shadowBlur=7;ctx.fillText(f.text,f.x,f.y);ctx.shadowBlur=0;
      });ctx.globalAlpha=1;ctx.restore();
      }
    }catch(error){
      if(!renderErrorLogged){
        renderErrorLogged=true;
        try{console.error('Arena render recovered after error',error);}catch(_){}
      }
      try{ctx.restore();}catch(_){}
    }finally{
      requestAnimationFrame(render);
    }
  }
  function tick(){
    const now=performance.now(),dt=Math.min(.1,Math.max(0,(now-lastLogic)/1000));lastLogic=now;
    if(loaded&&playing&&!paused){
      if(selectedMode==='online'&&net&&net.connected){
        const oldHold=networkHold;
        if(onlineRole==='host'){
          const stallLimit=Math.max(6500,Math.min(15000,6500+(net.ping||0)*8));
          // Host receives guest heartbeats as input packets. lastState belongs to the guest side only.
          networkHold=now-lastRemoteInput>stallLimit;
          if(now-lastRemoteInput>1400){remoteInput=empty();clearRemoteActions();}
          if(game.state.phase!=='fight'||game.state.round!==observedRound){clearRemoteActions();observedRound=game.state.round;}
          game.step(dt,[inputFor(0),remoteControls()]);effects(game.drainEvents());
          stateClock+=dt;
          if(stateClock>=.05){stateClock=0;net.send({type:'state',seq:++stateSeq,state:game.snapshot(),paused:false});}
        }else{
          const stallLimit=Math.max(6500,Math.min(15000,6500+(net.ping||0)*8));
          networkHold=remoteHostPaused||now-lastState>stallLimit;
          inputClock+=dt;
          if(inputClock>=1/30){inputClock=0;sendInput();}
        }
        if(oldHold!==networkHold)hudState='';
      }else if(selectedMode!=='online'){
        const beforeX=game.state.fighters[0].x;
        game.step(dt,[inputFor(0),inputFor(1)]);
        const events=game.drainEvents();
        if(selectedMode==='training')observeTraining(events,beforeX);
        effects(events);
      }
    }
    uiClock+=dt;if(uiClock>.065){uiClock=0;updateHUD();}
  }

  document.addEventListener('keydown',e=>{
    if(e.target.matches('input,textarea,select')||e.target.isContentEditable||$('helpDialog').open||controls.isOpen)return;
    const controlCodes=controls.codes();
    if(playing&&(controlCodes.has(e.code)||e.code==='KeyP'||e.code==='Escape'))e.preventDefault();
    if((e.code==='KeyP'||e.code==='Escape')&&!e.repeat){togglePause();return;}
    if(controlCodes.has(e.code)){
      const before=inputFor(0);keys.add(e.code);
      for(let player=0;player<2;player++){
        const map=controls.mapping(player);
        if(e.code===map.left||e.code===map.right){
          directionPriority[player]=e.code===map.left?'left':'right';
          if(e.repeat)keyRepeatGrace.set(e.code,performance.now()+KEY_REPEAT_GRACE_MS);
          else directionTapBuffer.set(e.code,performance.now()+DIRECTION_TAP_BUFFER_MS);
        }
      }
      if(!e.repeat){unlockAudio();const after=inputFor(0);for(const a of tapKeys){if(after[a]&&!before[a])localActions[a]++;}}
      sendInput();
    }
  });
  document.addEventListener('keyup',e=>{
    keys.delete(e.code);
    let directionKey=false;
    for(let player=0;player<2;player++){
      const map=controls.mapping(player);
      if(e.code===map.left||e.code===map.right)directionKey=true;
    }
    if(!directionKey||!keyRepeatGrace.has(e.code))keyRepeatGrace.delete(e.code);
    for(let player=0;player<2;player++)reconcileDirectionPriority(player);
    sendInput();
  });
  window.addEventListener('blur',()=>{
    releaseKeys();if(playing&&selectedMode!=='online')togglePause(true);
  });
  document.addEventListener('visibilitychange',()=>{
    if(selectedMode!=='online')releaseKeys();
    if(document.hidden&&playing&&selectedMode!=='online')togglePause(true);
    if(!document.hidden)lastLogic=performance.now();
  });
  document.querySelectorAll('.mode-card').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.mode)));
  document.querySelectorAll('[data-quick-mode]').forEach(b=>b.addEventListener('click',()=>selectMode(b.dataset.quickMode)));
  const mobilePrimaryBtn=$('mobilePrimaryBtn');
  mobilePrimaryBtn.addEventListener('pointerup',event=>{
    if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
    if(playing||!loaded||selectedMode==='online')return;
    event.preventDefault();
    beginGame(selectedMode);
  });
  mobilePrimaryBtn.addEventListener('click',()=>{
    if(playing||!loaded)return;
    if(selectedMode!=='online'){beginGame(selectedMode);return;}
    if(!net||!roomRoster){
      if(RoosterNet.validCode(invitedCode)){
        joinRoomCode(invitedCode,true);
      }else{
        onlineAutoCreating=false;
        maybeAutoHostOnline();
      }
      return;
    }
    if(!roomRoster.guest){shareInvite();return;}
    const self=onlineRole==='guest'?roomRoster.guest:roomRoster.host;
    if(!self||!self.ready){$('readyBtn').click();return;}
    if(onlineRole==='host'&&!$('launchBtn').disabled)$('launchBtn').click();
  });
  $('mobileSettingsBtn').addEventListener('click',()=>{
    if(!$('settingsMenu'))return;
    $('settingsMenu').open=true;
    $('settingsMenu').scrollIntoView({behavior:'smooth',block:'start'});
  });
  function showMobileGuide(section){
    const dialog=$('mobileGuideDialog');if(!dialog)return;
    const titles={play:'Cách chơi',setup:'Setup sân',invite:'Mời bạn'};
    $('mobileGuideTitle').textContent=titles[section]||'Hướng dẫn nhanh';
    dialog.querySelectorAll('[data-guide-section]').forEach(el=>el.hidden=el.dataset.guideSection!==section);
    dialog.showModal();
  }
  document.querySelectorAll('[data-mobile-guide]').forEach(button=>button.addEventListener('click',()=>showMobileGuide(button.dataset.mobileGuide)));
  $('closeMobileGuide').addEventListener('click',()=>$('mobileGuideDialog').close());
  $('mobileGuideDialog').addEventListener('click',e=>{if(e.target===$('mobileGuideDialog'))e.target.close();});
  $('powerMode').addEventListener('change',()=>{applyLocalPowerRules(selectedMode);updatePowerModeHint();});
  $('saveRoosterName').addEventListener('click',async()=>{
    try{await ensureProfile();const r=await RoosterProfile.rename($('roosterName').value);profileState=RoosterProfile.state;updateProfileUI();toast('Đã lưu tên chiến kê: '+r.name+'.');}
    catch(error){toast('Không lưu được tên chiến kê: '+error.message);}
  });
  $('resetTrainingBtn').addEventListener('click',()=>{if(selectedMode==='training')beginGame('training');});
  $('exitTrainingBtn').addEventListener('click',()=>selectMode('bot'));
  $('startBtn').addEventListener('click',()=>beginGame(selectedMode));
  $('createBtn').addEventListener('click',hostRoom);
  $('joinForm').addEventListener('submit',joinRoom);
  $('roomInput').addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6);});
  $('leaveBtn').addEventListener('click',lobby);
  $('readyBtn').addEventListener('click',async()=>{
    if(!net||!roomRoster)return;
    const current=net,self=onlineRole==='guest'?roomRoster.guest:roomRoster.host;
    $('readyBtn').disabled=true;
    try{await current.setReady(!self.ready);}catch(e){toast(e.message);}finally{if(net===current&&roomRoster)renderRoom(roomRoster);}
  });
  $('launchBtn').addEventListener('click',async()=>{
    if(!net)return;const current=net;$('launchBtn').disabled=true;
    try{await current.start();}catch(e){toast(e.message);if(net===current&&roomRoster)renderRoom(roomRoster);}
  });
  $('copyInviteBtn').addEventListener('click',shareInvite);
  function returnToLobby(event){
    if(event)event.preventDefault();
    $('resultOverlay').hidden=true;resultShown=false;playing=false;paused=false;
    lobby();
  }
  $('returnBtn').addEventListener('pointerup',event=>{
    if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
    returnToLobby(event);
  });
  $('returnBtn').addEventListener('click',event=>{
    if($('resultOverlay').hidden)return;
    returnToLobby(event);
  });
  $('rematchBtn').addEventListener('click',requestRematch);
  $('pauseBtn').addEventListener('click',()=>togglePause());
  if($('resumeBtn')){
    $('resumeBtn').addEventListener('pointerup',event=>{
      if(event.pointerType!=='touch'&&event.pointerType!=='pen')return;
      event.preventDefault();
      if(paused)togglePause(false);
    });
    $('resumeBtn').addEventListener('click',event=>{
      event.preventDefault();
      if(paused)togglePause(false);
    });
  }
  $('exitMatchBtn').addEventListener('click',()=>lobby());
  $('copyBtn').addEventListener('click',async()=>{
    const code=$('roomCode').textContent;
    try{
      await navigator.clipboard.writeText(code);toast('Đã sao chép mã phòng '+code+'.');
    }catch(_){
      const range=document.createRange();range.selectNodeContents($('roomCode'));
      const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);
      toast('Mã đã được chọn. Nhấn Ctrl+C để sao chép.');
    }
  });
  function showHelp(){
    beforeHelpPaused=paused;
    if(playing&&selectedMode!=='online')togglePause(true);
    releaseKeys();$('helpDialog').showModal();
  }
  $('helpBtn').addEventListener('click',showHelp);$('keysBtn').addEventListener('click',()=>controls.open());
  $('closeHelp').addEventListener('click',()=>$('helpDialog').close());
  $('helpDialog').addEventListener('close',()=>{
    if(playing&&selectedMode!=='online'&&!beforeHelpPaused)togglePause(false);
  });
  $('helpDialog').addEventListener('click',e=>{if(e.target===$('helpDialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
  $('soundBtn').addEventListener('click',()=>{
    isMuted=!isMuted;
    $('soundBtn').setAttribute('aria-pressed',String(!isMuted));
    $('soundBtn').setAttribute('aria-label',isMuted?'Bật âm thanh':'Tắt âm thanh');
    $('soundBtn').title=isMuted?'Bật âm thanh':'Tắt âm thanh';
    $('soundWaves').setAttribute('d',isMuted?'m16 9 6 6m0-6-6 6':'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14');
    unlockAudio();if(!isMuted)tone(660,.1,.04,'sine');
    toast(isMuted?'Đã tắt âm thanh.':'Đã bật âm thanh.');
  });
  $('fullscreenBtn').addEventListener('click',async()=>{
    try{if(document.fullscreenElement)await document.exitFullscreen();else await $('arena').requestFullscreen();}
    catch(_){toast('Nhấn F11 để mở trình duyệt toàn màn hình.');}
  });
  document.querySelector('.brand').addEventListener('click',e=>{e.preventDefault();lobby();});
  window.addEventListener('beforeunload',()=>{if(net)net.close();});

  function loadImage(image,src){
    return new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=src;});
  }
  Promise.all([
    loadImage(images.atlas,window.ROOSTER_ASSETS.atlas),
    loadImage(images.background,window.ROOSTER_ASSETS.background),
    loadImage(images.walk,window.ROOSTER_ASSETS.walkAtlas),
    document.fonts.load('400 16px "Noto Sans Game"', 'ĐẤU TRƯỜNG GÀ — Chọn cách chơi'),
    document.fonts.load('700 16px "Noto Sans Game"', 'Đánh đúng lúc, thắng đúng nhịp'),
    document.fonts.load('italic 400 16px "Noto Sans Game"', 'Bản lĩnh trong từng nhịp cánh')
  ]).then(()=>{
    loaded=true;
    try{
      $('arena').style.backgroundImage='url("'+window.ROOSTER_ASSETS.background+'")';
      $('arena').style.backgroundSize='cover';
      $('arena').style.backgroundPosition='center';
    }catch(_){}
    ensureRenderLoop();
    $('loading').hidden=true;$('startBtn').disabled=false;$('startBtn').textContent=selectedMode==='training'?'BẮT ĐẦU TẬP →':'BẮT ĐẦU TRẬN →';syncMobileQuickAction();
    setRoles();updateHUD();maybeAutoJoinInvite();maybeAutoHostOnline();
  }).catch(()=>{
    $('loading').textContent='Không đọc được hình ảnh hoặc font chữ. Hãy tải lại file HTML đầy đủ rồi mở lại.';
  });
  try{$('playerName').value=localStorage.getItem('rooster-player-name')||'';}catch(_){}
  const hasInviteRoom=RoosterNet.validCode(invitedCode);
  document.body.classList.toggle('invite-guest',hasInviteRoom);
  selectMode(hasInviteRoom?'online':'training');
  if(hasInviteRoom){
    $('roomInput').value=invitedCode;
    $('roomEntry').hidden=true;
    $('networkStatus').textContent='Link mời hợp lệ · đang chuẩn bị vào phòng '+invitedCode+'…';
  }
  ensureProfile().then(()=>{profileState=RoosterProfile.state;updateProfileUI();setRoles();maybeAutoJoinInvite();}).catch(()=>{maybeAutoJoinInvite();});
  updateTrainingUI();setRoles();setupTouchControls();syncMobileQuickAction();
  setInterval(tick,1000/60);ensureRenderLoop();
})();
