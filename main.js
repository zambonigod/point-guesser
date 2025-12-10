// Main logic for Paraboloid Point Guesser
(function(){
  const viewer = document.getElementById('viewer');
  const equationEl = document.getElementById('equation');
  const targetXY = document.getElementById('targetXY');
  const inpX = document.getElementById('inpX');
  const inpY = document.getElementById('inpY');
  const inpZ = document.getElementById('inpZ');
  const submitBtn = document.getElementById('submitBtn');
  const resultBox = document.getElementById('result');
  const scoreEl = document.getElementById('score');
  const revealEl = document.getElementById('reveal');
  
  // Modal popup elements
  const modalOverlay = document.getElementById('modalOverlay');
  const resultModal = document.getElementById('resultModal');
  const roundTitle = document.getElementById('roundTitle');
  const distanceText = document.getElementById('distanceText');
  const scoreBarFill = document.getElementById('scoreBarFill');
  const scoreText = document.getElementById('scoreText');
  const guessCoords = document.getElementById('guessCoords');
  const correctCoords = document.getElementById('correctCoords');
  const totalScoreText = document.getElementById('totalScoreText');
  const nextRoundBtn = document.getElementById('nextRoundBtn');
  const endGameBtn = document.getElementById('endGameBtn');
  
  // Game state
  let currentRound = 1; // 1, 2, or 3
  let totalScore = 0;
  const roundScores = [0, 0, 0]; // points for each round

  // Scene setup
  const scene = new THREE.Scene();
  // safe initial sizing: viewer may not be laid out yet, so fall back to sensible defaults
  const initialWidth = viewer.clientWidth || 800;
  const initialHeight = viewer.clientHeight || 600;
  const camera = new THREE.PerspectiveCamera(45, initialWidth/initialHeight, 0.1, 1000);
  camera.position.set(12,12,12);

  const renderer = new THREE.WebGLRenderer({antialias:true});
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(initialWidth, initialHeight);
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.setClearColor(0x071224, 1);
  viewer.appendChild(renderer.domElement);
  // ensure viewer has a layout context
  viewer.style.position = viewer.style.position || 'relative';

  // OrbitControls may not be available depending on how Three.js was loaded.
  let controls = null;
  try{
    if(typeof THREE.OrbitControls === 'function'){
      controls = new THREE.OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = true;
      controls.enableZoom = true;
      controls.enableRotate = true;
      controls.autoRotate = false;
      controls.target.set(0,0,0);
      controls.update();
    } else {
      console.warn('OrbitControls not found on THREE. Controls disabled.');
    }
  }catch(err){
    console.warn('Failed to initialize OrbitControls:', err);
  }

  const light = new THREE.DirectionalLight(0xffffff, 0.9);
  light.position.set(5,10,7);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0x888888, 0.6));

  // Helpers
  let parabMesh, truePointMesh, guessPointMesh, connectorLine;
  let gridHelper = null;
  // parentGroup holds both the grid and the content group so we can rotate the whole scene
  const parentGroup = new THREE.Group();
  const group = new THREE.Group();
  parentGroup.add(group);
  scene.add(parentGroup);
  // raycasting for cursor interaction
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let isPointerDownOnMesh = false;

  // Parameters
  const RANGE = 5; // x,y range [-RANGE,RANGE]
  const GRID = 120; // mesh resolution

  // Earth texture (use a stable Three.js hosted texture)
  const textureLoader = new THREE.TextureLoader();
  let earthTexture = null;
  const earthUrl = 'https://threejs.org/examples/textures/land_ocean_ice_cloud_2048.jpg';
  
  // Promise-based texture loading to ensure first round waits for texture
  const textureLoadPromise = new Promise((resolve) => {
    textureLoader.load(
      earthUrl,
      (tex) => { earthTexture = tex; resolve(); },
      undefined,
      (err) => { console.warn('Failed to load earth texture, continuing without map.', err); resolve(); }
    );
  });

  // Paraboloid coefficients: z = A*x^2 + B*y^2 + k
  function randomCoeffs(){
    const A = +(Math.random()*2.4 - 1.2).toFixed(3); // -1.2 .. 1.2
    const B = +(Math.random()*2.4 - 1.2).toFixed(3);
    const k = +(Math.random()*10 - 5).toFixed(3); // -5 .. 5
    return { A, B, k };
  }

  let coeffs = randomCoeffs();
  let target = {x:0,y:0,z:0};

  function formatEquation(co){
    // z = A x^2 + B y^2 + k
    function fmt(n, term){
      const s = (n<0?'- ':'+ ') + Math.abs(n).toFixed(3) + term;
      return s;
    }
    let s = `${co.A.toFixed(3)} x² ${co.B<0?fmt(co.B,' y²'):fmt(co.B,' y²')} ${co.k<0?fmt(co.k,''):fmt(co.k,'')}`;
    // tidy leading +
    s = s.replace(/^\+ /,'');
    return s;
  }

  function evalZ(x,y,co){
    return co.A*x*x + co.B*y*y + co.k;
  }

  function buildParaboloid(){
    if(parabMesh) { group.remove(parabMesh); parabMesh.geometry.dispose(); parabMesh.material.dispose(); parabMesh = null; }

    // Build a plane and displace vertices in Z to create a paraboloid surface.
    const geometry = new THREE.PlaneGeometry(2*RANGE, 2*RANGE, GRID, GRID);
    // PlaneGeometry has vertices in X (width) and Y (height) with Z=0; we'll treat X,Y as our x,y
    const pos = geometry.attributes.position;
    for(let i=0;i<pos.count;i++){
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = evalZ(x, y, coeffs);
      pos.setZ(i, z);
    }
    pos.needsUpdate = true;

    // recompute normals after displacement
    geometry.computeVertexNormals();

    // Recalculate UVs to use a cylindrical-ish mapping based on X,Y coordinates
    const uv = geometry.attributes.uv;
    for(let i=0;i<pos.count;i++){
      const x = pos.getX(i);
      const y = pos.getY(i);
      const theta = Math.atan2(y, x);
      const radius = Math.sqrt(x*x + y*y) / RANGE;
      const tu = (theta + Math.PI) / (2*Math.PI);
      const tv = Math.min(1, radius);
      uv.setXY(i, tu, tv);
    }
    uv.needsUpdate = true;

    const matOpts = { side: THREE.DoubleSide };
    if(earthTexture) matOpts.map = earthTexture;
    const mat = new THREE.MeshStandardMaterial(matOpts);
    parabMesh = new THREE.Mesh(geometry, mat);
    parabMesh.receiveShadow = true;
    group.add(parabMesh);

    // compute bounding box and reframe camera so the mesh is visible
    try{
      geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      const center = new THREE.Vector3();
      box.getCenter(center);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxSize = Math.max(size.x, size.y, size.z);
      const fitDist = maxSize * 1.8;
      // position camera along the (1,1,1) direction at distance fitDist from center
      const camDir = new THREE.Vector3(1,1,1).normalize();
      camera.position.copy(center.clone().add(camDir.multiplyScalar(fitDist)));
      camera.lookAt(center);
      if(controls && typeof controls.target !== 'undefined'){
        controls.target.copy(center);
        if(typeof controls.update === 'function') controls.update();
      }
    }catch(err){
      console.warn('Could not compute bounding box to reframe camera', err);
    }

    // ensure a ground grid exists at z=0
    if(!gridHelper){
      gridHelper = new THREE.GridHelper(RANGE*6, 60, 0x2b3b4b, 0x16202a);
      gridHelper.rotation.x = 0;
      gridHelper.position.z = 0;
      parentGroup.add(gridHelper);
    }

    // update debug overlay
    const dbg = document.getElementById('dbg');
    if(dbg){
      const bb = geometry.boundingBox;
      dbg.innerText = `Vertices: ${geometry.attributes.position.count}  |  Bounds: [${bb.min.x.toFixed(1)},${bb.min.y.toFixed(1)},${bb.min.z.toFixed(1)}] → [${bb.max.x.toFixed(1)},${bb.max.y.toFixed(1)},${bb.max.z.toFixed(1)}]`;
    }
  }

  function plotPoint(x,y,z, color=0xff0000, size=0.14){
    const geom = new THREE.SphereGeometry(size, 16, 12);
    const mat = new THREE.MeshStandardMaterial({color});
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x,y,z);
    group.add(m);
    return m;
  }

  function drawConnector(aPos,bPos){
    if(connectorLine) group.remove(connectorLine);
    const pts = [new THREE.Vector3().copy(aPos), new THREE.Vector3().copy(bPos)];
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({color:0xffff00});
    connectorLine = new THREE.Line(g, mat);
    group.add(connectorLine);
  }

  async function newRound(){
    // Wait for texture to load on the very first round
    if(currentRound === 1 && !earthTexture){
      await textureLoadPromise;
    }
    // cleanup previous round assets first
    if(truePointMesh){ group.remove(truePointMesh); truePointMesh.geometry.dispose(); truePointMesh.material.dispose(); truePointMesh = null; }
    if(guessPointMesh){ group.remove(guessPointMesh); guessPointMesh.geometry.dispose(); guessPointMesh.material.dispose(); guessPointMesh = null; }
    if(connectorLine){ group.remove(connectorLine); connectorLine.geometry.dispose(); connectorLine.material.dispose(); connectorLine = null; }
    if(parabMesh){ group.remove(parabMesh); parabMesh.geometry.dispose(); parabMesh.material.dispose(); parabMesh = null; }
    // planeMesh/planeRim removed in refactor; gridHelper is used instead

    coeffs = randomCoeffs();
    // show equation immediately (helps visibility if build fails)
    equationEl.textContent = 'z = ' + formatEquation(coeffs);
    // reset rotation so new shape is shown upright
    parentGroup.rotation.set(0,0,0);
    // build and report errors to debug overlay
    const dbg = document.getElementById('dbg');
    try{
      buildParaboloid();
      if(dbg) dbg.innerText = `Built surface — A=${coeffs.A}, B=${coeffs.B}, k=${coeffs.k}`;
    }catch(err){
      console.error('Error building paraboloid:', err);
      if(dbg) dbg.innerText = `Error building surface: ${err && err.message ? err.message : err}`;
      // abort setting target if build failed
      return;
    }

    // choose random target x,y
    target.x = +(Math.random()*2*RANGE - RANGE).toFixed(3);
    target.y = +(Math.random()*2*RANGE - RANGE).toFixed(3);
    target.z = +evalZ(target.x, target.y, coeffs).toFixed(6);

    equationEl.textContent = 'z = ' + formatEquation(coeffs);
    targetXY.textContent = `x = ${target.x}, y = ${target.y}`;
    inpX.value = target.x;
    inpY.value = target.y;
    inpZ.value = '';

    resultBox.classList.add('hidden');

    // (cleanup already handled at start of function)
  }

  submitBtn.addEventListener('click', ()=>{
    const gx = parseFloat(inpX.value);
    const gy = parseFloat(inpY.value);
    const gz = parseFloat(inpZ.value);
    if(Number.isNaN(gx) || Number.isNaN(gy) || Number.isNaN(gz)){
      alert('Please enter numeric x, y, and z values.');
      return;
    }

    const trueZ = evalZ(gx, gy, coeffs);
    // But the true target is at target.x,target.y; evaluate true z at that point
    const truePos = new THREE.Vector3(target.x, target.y, evalZ(target.x, target.y, coeffs));
    const guessPos = new THREE.Vector3(gx, gy, gz);

    // Plot true point and guess
    if(truePointMesh){ group.remove(truePointMesh); }
    truePointMesh = plotPoint(truePos.x, truePos.y, truePos.z, 0x00ff88, 0.18);
    if(guessPointMesh){ group.remove(guessPointMesh); }
    guessPointMesh = plotPoint(guessPos.x, guessPos.y, guessPos.z, 0xff3344, 0.16);

    // Distance in 3D
    const dist = truePos.distanceTo(guessPos);
    const maxDist = Math.sqrt((2*RANGE)*(2*RANGE)*3); // cube diagonal heuristic
    const pct = Math.max(0, 100 - (dist / maxDist) * 100);

    scoreEl.innerHTML = `<strong>Closeness:</strong> ${pct.toFixed(2)}% (distance ${dist.toFixed(3)})`;
    revealEl.innerHTML = `<strong>True point:</strong> x=${target.x}, y=${target.y}, z=${target.z.toFixed(6)}`;
    resultBox.classList.remove('hidden');

    // Calculate points: 33.3 per round
    const roundPoints = Math.max(0, (1 - (dist / maxDist)) * 33.3);
    roundScores[currentRound - 1] = roundPoints;
    totalScore = roundScores.reduce((a, b) => a + b, 0);

    // Show GeoGuessr-style modal popup
    roundTitle.textContent = `Round ${currentRound} of 3`;
    distanceText.textContent = `Distance: ${dist.toFixed(3)} units`;
    scoreBarFill.style.width = `${(roundPoints / 33.3) * 100}%`;
    scoreText.textContent = `${roundPoints.toFixed(1)} / 33.3`;
    guessCoords.textContent = `x=${gx.toFixed(3)}, y=${gy.toFixed(3)}, z=${gz.toFixed(3)}`;
    correctCoords.textContent = `x=${target.x}, y=${target.y}, z=${target.z.toFixed(6)}`;
    totalScoreText.textContent = `Total Score: ${totalScore.toFixed(1)} / 100`;
    
    // Show modal and update button visibility
    if(currentRound < 3){
      nextRoundBtn.classList.remove('hidden');
      endGameBtn.classList.add('hidden');
    } else {
      nextRoundBtn.classList.add('hidden');
      endGameBtn.classList.remove('hidden');
    }
    modalOverlay.classList.remove('hidden');
    resultModal.classList.remove('hidden');

    drawConnector(truePos, guessPos);
  });

  // Next round button: show modal for 3 rounds, then end game
  nextRoundBtn.addEventListener('click', ()=>{
    modalOverlay.classList.add('hidden');
    resultModal.classList.add('hidden');
    if(currentRound < 3){
      currentRound++;
      newRound();
    }
  });
  
  // End game button (shown on round 3)
  endGameBtn.addEventListener('click', ()=>{
    // Show final score screen
    modalOverlay.classList.add('hidden');
    resultModal.classList.add('hidden');
    // Reset to round 1 for next game
    currentRound = 1;
    totalScore = 0;
    roundScores.fill(0);
    newRound();
  });

  // pointer interaction: change cursor when hovering over paraboloid and show grabbing cursor on down
  function updateMousePointer(event){
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    if(parabMesh){
      const hits = raycaster.intersectObject(parabMesh, true);
      if(hits.length){
        if(isPointerDownOnMesh){ renderer.domElement.style.cursor = 'grabbing'; }
        else { renderer.domElement.style.cursor = 'grab'; }
        return true;
      }
    }
    renderer.domElement.style.cursor = '';
    return false;
  }

  let isDragging = false;
  let lastPointer = {x:0,y:0};

  renderer.domElement.addEventListener('pointermove', (e)=>{
    // handle dragging rotation
    if(isDragging){
      const rect = renderer.domElement.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      const dx = x - lastPointer.x;
      const dy = y - lastPointer.y;
      const rotSpeed = Math.PI; // radians per normalized width
      // rotate group: horizontal drag -> y-rotation, vertical drag -> x-rotation
      parentGroup.rotation.y += dx * rotSpeed;
      parentGroup.rotation.x += dy * rotSpeed;
      lastPointer.x = x; lastPointer.y = y;
      return;
    }
    updateMousePointer(e);
  });

  renderer.domElement.addEventListener('pointerdown', (e)=>{
    const hit = updateMousePointer(e);
    if(hit){
      isPointerDownOnMesh = true;
      isDragging = true;
      // disable orbit controls while dragging the mesh
      if(controls) controls.enabled = false;
      const rect = renderer.domElement.getBoundingClientRect();
      lastPointer.x = (e.clientX - rect.left) / rect.width;
      lastPointer.y = (e.clientY - rect.top) / rect.height;
      renderer.domElement.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('pointerup', (e)=>{
    isPointerDownOnMesh = false;
    if(isDragging){ isDragging = false; if(controls) controls.enabled = true; }
    updateMousePointer(e);
  });

  // resize handling
  window.addEventListener('resize', ()=>{
    const w = Math.max(100, viewer.clientWidth);
    const h = Math.max(100, viewer.clientHeight);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(Math.max(100, viewer.clientWidth), Math.max(100, viewer.clientHeight));
  });

  function animate(){
    requestAnimationFrame(animate);
    if(controls && typeof controls.update === 'function') controls.update();
    renderer.render(scene, camera);
  }

  // initialize
  newRound();
  animate();

})();
