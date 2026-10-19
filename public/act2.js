/* ============================================================
   ACT 2: THE DESCENT — Season 1 Act 2 client module
   Hooks into the existing farm game (index.html).
   Loads after the main script, so all globals (THREE, ST, UI,
   send, scene, camera, player, etc.) are available.
   ============================================================ */
'use strict';

const Act2 = {
  // ===== STATE =====
  act2Launched: false,
  act2LaunchedAt: 0,
  maintenance: null,
  bloodDrops: 0,
  deciderAvailable: false,
  deciderClaimed: false,
  heartFed: 0,
  nearHeart: false,
  nearHorseman: false,
  s2guiOpen: false,
  s2gCurrent: 0,
  s2gModels: [],
  s2gScene: null,
  s2gRenderer: null,
  s2gCamera: null,
  s2gMixer: null,
  s2gRAF: null,

  // ===== 3D OBJECTS =====
  stairGroup: null,
  cavernGroup: null,
  heart: null,
  heartLight: null,
  horseman: null,
  horsemanEyes: [],
  mummy: null,
  bloodDrips: [],

  // ===== SPIRAL STAIRCASE TRACKING =====
  stairCenter: { x: 0, z: -17 },
  stairRadius: 5,
  stairPitch: 6,       // 6 units down per full turn
  stairMaxDescent: 30,
  stairPrevAngle: 0,
  stairCumAngle: 0,
  onStairPrev: false,

  // ===== S2 PET PREVIEW DATA =====
  // The 5 chosen models + their lore cards
  S2_PETS: [
    { file: '03_witch_scarecrow.glb', name: 'Hex Witch', rar: 'Epic', color: '#a86fd6',
      lore: 'A scarecrow possessed by the spirit of a hanged witch. Her tattered hat brims with cursed straw, and her button eyes follow you across the field. Planting near her boosts mutation chance — but her favor is fickle.' },
    { file: '04_skull_head.glb', name: 'Bone Wraith', rar: 'Legendary', color: '#e8a33d',
      lore: 'A hollow-skulled guardian stitched from graveyard linens and old bones. It moans when the blood moon rises. Equipping it as a pet grants a passive relic-find bonus during night events.' },
    { file: '05_reaper_scarecrow.glb', name: 'The Reaper', rar: 'Mythical', color: '#e05a8a',
      lore: 'The Headless Horseman\'s true form — a skeletal reaper wrapped in a death-cloak of stitched burlap. It harvests souls, not crops. The rarest of the S2 companions, and the most powerful.' },
    { file: '06_farmer_pitchfork.glb', name: 'Harvest Warden', rar: 'Rare', color: '#3f9fd6',
      lore: 'A scarecrow farmer eternally guarding his pitchfork. His wooden frame creaks in the wind. A loyal companion that boosts crop growth speed when equipped, and never abandons your plot.' },
    { file: '07_top_hat_gent.glb', name: 'Cursed Pioneer', rar: 'Epic', color: '#a86fd6',
      lore: 'A frontier gentleman cursed to wander the fields forever, his top hat stitched to his burlap skull. He trades relics for tokens — speak to him at dusk when the fog rolls in.' },
  ],

  // ============================================================
  // INIT — hook into the existing game
  // ============================================================
  init() {
    console.log('[Act2] Initializing THE DESCENT...');
    const A = this;

    // Hook into handleNet to intercept Act 2 messages
    if (typeof window.handleNet === 'function') {
      const orig = window.handleNet;
      window.handleNet = function (m) {
        if (A.handleNet(m)) return;  // Act2 handled it fully
        orig(m);                      // pass to original
      };
    }

    // Hook into the admin tabs to add Control tab
    A.hookAdminTabs();

    // Bind UI
    A.bindUI();

    // Start tick loop (runs alongside the main animate)
    A.tickLoop();

    // Spawn maintenance embers
    A.spawnMaintEmbers();

    // Check if we joined mid-act-2 (state will arrive via init/s2State)
    console.log('[Act2] Ready. Waiting for server state...');
  },

  // ============================================================
  // NETWORK HANDLER — returns true if message was fully handled
  // ============================================================
  handleNet(m) {
    const A = this;
    switch (m.t) {
      case 'maintenance':
        A.showMaintenance(m);
        return true;

      case 'act2Launch':
        A.onAct2Launch(m);
        return true;

      case 'heartFed':
        A.onHeartFed(m);
        return false;  // also let original handle it (if it does)

      case 'deciderClaimed':
        A.onDeciderClaimed(m);
        return true;

      case 's2State':
        A.onS2State(m);
        return false;  // let original handle too

      case 'init':
        // After init, check our state
        setTimeout(() => A.onInit(m), 50);
        return false;

      case 'me':
        // Track blood drops from me updates
        if (m.me && m.me.bloodDrops !== undefined) {
          A.bloodDrops = m.me.bloodDrops;
          A.deciderClaimed = !!m.me.deciderBought;
          A.updateBloodChip();
        }
        return false;

      case 'admData':
        if (m.kind === 'deciderWishes') {
          A.renderDeciderWishes(m.data);
          return true;  // we handle this
        }
        return false;

      default:
        return false;
    }
  },

  // ============================================================
  // ON INIT — check state after joining
  // ============================================================
  onInit(m) {
    const A = this;
    if (m.maintenance) A.showMaintenance(m.maintenance);
    if (m.s2) {
      A.act2Launched = !!m.s2.act2Launched;
      A.act2LaunchedAt = m.s2.act2LaunchedAt || 0;
      A.heartFed = m.s2.heartFed || 0;
      A.deciderAvailable = (m.s2.deciderClaimed === 'available');
      if (A.act2Launched && !A.stairGroup) A.buildStaircase();
      if (A.act2Launched && !A.cavernGroup) A.buildCavern();
      if (A.act2Launched && !A.heart) A.buildHeart();
      if (A.act2Launched && !A.horseman) A.spawnHorseman();
    }
    if (m.self && m.self.bloodDrops !== undefined) {
      A.bloodDrops = m.self.bloodDrops;
      A.deciderClaimed = !!m.self.deciderBought;
      A.updateBloodChip();
    }
  },

  onS2State(m) {
    const A = this;
    if (!m.s2) return;
    const s = m.s2;
    const wasLaunched = A.act2Launched;
    A.act2Launched = !!s.act2Launched;
    A.act2LaunchedAt = s.act2LaunchedAt || 0;
    A.heartFed = s.heartFed || 0;
    A.deciderAvailable = (s.deciderClaimed === 'available');

    if (A.act2Launched && !wasLaunched) {
      // Just launched while we were online
      A.buildStaircase();
      A.buildCavern();
      A.buildHeart();
      A.spawnHorseman();
    }
  },

  // ============================================================
  // MAINTENANCE SCREEN
  // ============================================================
  maintRAF: null,
  showMaintenance(m) {
    const A = this;
    // m = {until, msg, fix, by}  OR  {until:0} to clear
    if (!m || !m.until || m.until <= 0) {
      A.hideMaintenance();
      return;
    }
    A.maintenance = m;
    // Admins don't get the full-screen overlay (they need to work)
    const isAdmin = (typeof ST !== 'undefined' && ST.adminToken);
    if (!isAdmin) {
      const ov = document.getElementById('maintOv');
      if (!ov) return;
      ov.classList.add('on');
      document.getElementById('maintReason').textContent = m.msg || 'We are working on the island.';
      document.getElementById('maintFix').textContent = m.fix ? 'Fixing: ' + m.fix : '';
      document.getElementById('maintBy').textContent = m.by ? 'Closed by ' + m.by : '';
      A.tickMaintenance();
    }
    // If the Control tab is open, refresh it to show the new state
    const ctrlCard = document.querySelector('.admCtrlCard');
    if (ctrlCard && document.querySelector('[data-act2="control"].on')) {
      A.renderControlTab();
    }
  },

  hideMaintenance() {
    const A = this;
    A.maintenance = null;
    const ov = document.getElementById('maintOv');
    if (ov) ov.classList.remove('on');
    if (A.maintRAF) { cancelAnimationFrame(A.maintRAF); A.maintRAF = null; }
  },

  tickMaintenance() {
    const A = this;
    if (!A.maintenance) return;
    const rem = Math.max(0, A.maintenance.until - Date.now());
    const el = document.getElementById('maintCountdown');
    if (el) {
      const min = Math.floor(rem / 60000);
      const sec = Math.floor((rem % 60000) / 1000);
      el.textContent = String(min).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
      el.classList.toggle('urgent', rem < 60000);
    }
    if (rem <= 0) {
      A.hideMaintenance();
      // Reload to rejoin
      setTimeout(() => location.reload(), 800);
      return;
    }
    A.maintRAF = requestAnimationFrame(() => A.tickMaintenance());
  },

  spawnMaintEmbers() {
    const A = this;
    const ov = document.getElementById('maintOv');
    if (!ov) return;
    // Pre-create 30 ember elements
    for (let i = 0; i < 30; i++) {
      const e = document.createElement('div');
      e.className = 'maintEmber';
      e.style.left = (Math.random() * 100) + 'vw';
      e.style.animationDuration = (6 + Math.random() * 8) + 's';
      e.style.animationDelay = (-Math.random() * 10) + 's';
      e.style.width = e.style.height = (4 + Math.random() * 6) + 'px';
      ov.appendChild(e);
    }
  },

  // ============================================================
  // BLOOD DROPS HUD CHIP
  // ============================================================
  updateBloodChip() {
    const A = this;
    const chip = document.getElementById('bloodChip');
    if (!chip) return;
    // Show chip only when Act 2 is launched or player has blood drops
    if (A.act2Launched || A.bloodDrops > 0) {
      chip.classList.add('on');
    } else {
      chip.classList.remove('on');
      return;
    }
    const drops = A.bloodDrops;
    document.getElementById('bloodDrops').textContent = A.fmt(drops);
    const goal = 1000000000; // 1B
    const pct = Math.min(100, (drops / goal) * 100);
    const bar = document.querySelector('#bloodBar i');
    if (bar) bar.style.width = pct + '%';
  },

  fmt(n) {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.floor(n));
  },

  // ============================================================
  // ACT 2 LAUNCH CINEMATIC
  // ============================================================
  onAct2Launch(m) {
    const A = this;
    A.act2Launched = true;
    A.act2LaunchedAt = m.at;

    // Show the banner
    const banner = document.getElementById('act2Banner');
    if (banner) {
      banner.classList.add('on');
      setTimeout(() => banner.classList.remove('on'), 5000);
    }

    // Rumble
    if (typeof doShake === 'function') doShake(0.8, 2.0);
    if (typeof AudioSys !== 'undefined') {
      AudioSys.play('rumble');
      setTimeout(() => AudioSys.play('rumble'), 600);
      setTimeout(() => AudioSys.play('rumble'), 1200);
    }

    // Shift sky to dusk-red
    A.shiftSkyToDuskRed();

    // Build the 3D content after the cinematic moment
    setTimeout(() => {
      A.buildStaircase();
      A.buildCavern();
      A.buildHeart();
      A.spawnHorseman();
      A.updateBloodChip();
    }, 1500);

    // Global announcement
    if (typeof showAnnounce === 'function') {
      showAnnounce('THE ISLAND CRACKS OPEN — THE DESCENT BEGINS', {
        color: '#ff3010', style: 'spooky', dur: 8
      });
    }
  },

  shiftSkyToDuskRed() {
    const A = this;
    if (typeof scene === 'undefined') return;
    // Override the day cycle to a permanent dusk-red
    if (window.ST) ST.dayOverride = 0.78; // dusk
    // Tint the fog red
    if (scene.fog) {
      scene.fog.color.setHex(0x2a0a0a);
      scene.fog.near = 15;
      scene.fog.far = 100;
    }
    scene.background = new THREE.Color(0x1a0606);
  },

  // ============================================================
  // GROUND HEIGHT AT — the spiral staircase movement system
  // ============================================================
  groundHeightAt(x, z, currentY) {
    const A = this;
    if (!A.act2Launched) return 0;

    const dx = x - A.stairCenter.x;
    const dz = z - A.stairCenter.z;
    const d = Math.hypot(dx, dz);

    // Staircase shaft — anywhere within stairRadius+1.5 of the center
    const onStair = (d < A.stairRadius + 1.5 && d > 0.3);

    if (onStair) {
      let theta = Math.atan2(dz, dx);
      if (!A.onStairPrev) {
        A.stairPrevAngle = theta;
        A.onStairPrev = true;
      }
      let delta = theta - A.stairPrevAngle;
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      A.stairCumAngle += delta;
      A.stairPrevAngle = theta;

      // Clamp cumulative angle so you can't go above the top
      A.stairCumAngle = Math.max(0, A.stairCumAngle);

      let targetY = -A.stairPitch * (A.stairCumAngle / (2 * Math.PI));
      targetY = Math.max(-A.stairMaxDescent, targetY);
      return targetY;
    } else {
      A.onStairPrev = false;
    }

    // Cavern floor
    if (currentY < -15) return -A.stairMaxDescent;

    // Island surface
    return 0;
  },

  // ============================================================
  // BUILD SPIRAL STAIRCASE (3D geometry)
  // ============================================================
  buildStaircase() {
    const A = this;
    if (A.stairGroup) return;
    console.log('[Act2] Building spiral staircase...');

    const g = new THREE.Group();
    const cx = A.stairCenter.x, cz = A.stairCenter.z;
    const r = A.stairRadius;
    const steps = 80;  // total steps around the spiral
    const totalTurns = A.stairMaxDescent / A.stairPitch;  // ~5 turns
    const anglePerStep = (totalTurns * Math.PI * 2) / steps;
    const yPerStep = A.stairMaxDescent / steps;

    // Build steps
    const stepMat = new THREE.MeshLambertMaterial({ color: 0x4a3a3a });
    const stepMatDark = new THREE.MeshLambertMaterial({ color: 0x2a1a1a });
    for (let i = 0; i < steps; i++) {
      const angle = i * anglePerStep;
      const y = -i * yPerStep;
      const stepGeom = new THREE.BoxGeometry(r * 1.8, 0.3, r * 0.8);
      const step = new THREE.Mesh(stepGeom, i % 2 ? stepMat : stepMatDark);
      step.position.set(
        cx + Math.cos(angle) * r * 0.5,
        y,
        cz + Math.sin(angle) * r * 0.5
      );
      step.rotation.y = -angle;
      step.receiveShadow = true;
      step.castShadow = true;
      g.add(step);
    }

    // Central column
    const colGeom = new THREE.CylinderGeometry(0.8, 0.8, A.stairMaxDescent, 16);
    const col = new THREE.Mesh(colGeom, new THREE.MeshLambertMaterial({ color: 0x3a2a2a }));
    col.position.set(cx, -A.stairMaxDescent / 2, cz);
    col.receiveShadow = true;
    g.add(col);

    // Outer wall (cylinder) — so you can't see through
    const wallGeom = new THREE.CylinderGeometry(r + 1.5, r + 1.5, A.stairMaxDescent, 32, 1, true);
    const wall = new THREE.Mesh(wallGeom, new THREE.MeshLambertMaterial({
      color: 0x1a0a0a, side: THREE.BackSide
    }));
    wall.position.set(cx, -A.stairMaxDescent / 2, cz);
    g.add(wall);

    // Mouth — a cracked opening at the top (visual only)
    const mouthGeom = new THREE.RingGeometry(r + 1.5, r + 3, 32);
    const mouth = new THREE.Mesh(mouthGeom, new THREE.MeshBasicMaterial({
      color: 0x0a0202, side: THREE.DoubleSide, transparent: true, opacity: 0.8
    }));
    mouth.rotation.x = -Math.PI / 2;
    mouth.position.set(cx, 0.05, cz);
    g.add(mouth);

    // Glowing red rim around the mouth
    const rimGeom = new THREE.TorusGeometry(r + 1.6, 0.15, 8, 32);
    const rim = new THREE.Mesh(rimGeom, new THREE.MeshBasicMaterial({ color: 0xff3010 }));
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(cx, 0.1, cz);
    g.add(rim);
    A.stairRim = rim;

    // Blood-red fog particles in the shaft
    const fogN = 60;
    const fogGeo = new THREE.BufferGeometry();
    const fogPos = new Float32Array(fogN * 3);
    for (let i = 0; i < fogN; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * r;
      fogPos[i * 3] = cx + Math.cos(a) * rr;
      fogPos[i * 3 + 1] = -Math.random() * A.stairMaxDescent;
      fogPos[i * 3 + 2] = cz + Math.sin(a) * rr;
    }
    fogGeo.setAttribute('position', new THREE.BufferAttribute(fogPos, 3));
    const fogMat = new THREE.PointsMaterial({
      color: 0xff2010, size: 1.5, transparent: true, opacity: 0.4, depthWrite: false
    });
    const fog = new THREE.Points(fogGeo, fogMat);
    g.add(fog);
    A.stairFog = fog;

    scene.add(g);
    A.stairGroup = g;
    console.log('[Act2] Staircase built.');
  },

  // ============================================================
  // BUILD UNDERGROUND CAVERN
  // ============================================================
  buildCavern() {
    const A = this;
    if (A.cavernGroup) return;
    console.log('[Act2] Building underground cavern...');

    const g = new THREE.Group();
    const floorY = -A.stairMaxDescent;

    // Blood lake (floor)
    const lakeGeom = new THREE.CircleGeometry(38, 48);
    const lakeMat = new THREE.MeshLambertMaterial({
      color: 0x4a0808, emissive: new THREE.Color(0x200000), emissiveIntensity: 0.3
    });
    const lake = new THREE.Mesh(lakeGeom, lakeMat);
    lake.rotation.x = -Math.PI / 2;
    lake.position.set(0, floorY + 0.1, 0);
    lake.receiveShadow = true;
    g.add(lake);

    // Floating heart island at center
    const islandGeom = new THREE.CylinderGeometry(8, 6, 3, 16);
    const islandMat = new THREE.MeshLambertMaterial({ color: 0x3a1a1a });
    const island = new THREE.Mesh(islandGeom, islandMat);
    island.position.set(0, floorY + 1.5, 0);
    island.castShadow = true;
    island.receiveShadow = true;
    g.add(island);

    // Stalactites hanging from the ceiling (y=0 down to y=-20)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
      const r = 15 + Math.random() * 18;
      const len = 4 + Math.random() * 8;
      const stGeom = new THREE.ConeGeometry(0.6 + Math.random() * 0.4, len, 6);
      const st = new THREE.Mesh(stGeom, new THREE.MeshLambertMaterial({ color: 0x2a1a1a }));
      st.position.set(Math.cos(a) * r, -len / 2 - 1, Math.sin(a) * r);
      st.rotation.z = (Math.random() - 0.5) * 0.3;
      g.add(st);
    }

    // Cavern walls (cylinder, BackSide so we see the inside)
    const wallGeom = new THREE.CylinderGeometry(40, 40, 30, 32, 1, true);
    const wallMat = new THREE.MeshLambertMaterial({
      color: 0x1a0a0a, side: THREE.BackSide
    });
    const wall = new THREE.Mesh(wallGeom, wallMat);
    wall.position.set(0, floorY + 15, 0);
    g.add(wall);

    // Drip particles
    const dripN = 40;
    const dripGeo = new THREE.BufferGeometry();
    const dripPos = new Float32Array(dripN * 3);
    const dripVel = [];
    for (let i = 0; i < dripN; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 35;
      dripPos[i * 3] = Math.cos(a) * r;
      dripPos[i * 3 + 1] = -Math.random() * 25;
      dripPos[i * 3 + 2] = Math.sin(a) * r;
      dripVel.push({ vy: -1 - Math.random() * 2, base: dripPos[i * 3 + 1] });
    }
    dripGeo.setAttribute('position', new THREE.BufferAttribute(dripPos, 3));
    const dripMat = new THREE.PointsMaterial({
      color: 0xff2010, size: 0.25, transparent: true, opacity: 0.8, depthWrite: false
    });
    const drips = new THREE.Points(dripGeo, dripMat);
    g.add(drips);
    A.cavernDrips = { points: drips, vel: dripVel, floorY: floorY };

    // Red point light in the cavern
    const cavernLight = new THREE.PointLight(0xff2010, 1.5, 60);
    cavernLight.position.set(0, floorY + 10, 0);
    g.add(cavernLight);
    A.cavernLight = cavernLight;

    // Mummy guardian — load 04_skull_head (closest to mummy in our set)
    A.spawnMummy(g, floorY);

    g.visible = true;  // always visible (it's below the island, you only see it when you descend)
    scene.add(g);
    A.cavernGroup = g;
    console.log('[Act2] Cavern built.');
  },

  spawnMummy(parent, floorY) {
    const A = this;
    if (typeof THREE.GLTFLoader === 'undefined') {
      console.warn('[Act2] GLTFLoader not available for mummy');
      return;
    }
    const loader = new THREE.GLTFLoader();
    loader.load('/04_skull_head.glb', (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) return;
      const scale = 2.5 / size.y;
      model.scale.setScalar(scale);
      model.position.set(10, floorY + 3 - bounds.min.y * scale, 5);
      model.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
      parent.add(model);
      A.mummy = model;
      console.log('[Act2] Mummy guardian loaded.');
    }, undefined, (err) => console.error('[Act2] Mummy load failed:', err));
  },

  // ============================================================
  // BUILD PROCEDURAL LIVING HEART
  // ============================================================
  buildHeart() {
    const A = this;
    if (A.heart) return;
    console.log('[Act2] Building procedural Living Heart...');

    const g = new THREE.Group();
    const heartY = -A.stairMaxDescent + 5;  // floating above the island

    // Main heart body — two deformed spheres
    const bodyMat = new THREE.MeshLambertMaterial({
      color: 0x8a0a0a, emissive: new THREE.Color(0x4a0000), emissiveIntensity: 0.4
    });
    const lobeGeom = new THREE.SphereGeometry(1.5, 16, 14);
    // Deform the spheres to look heart-like
    const lobeL = new THREE.Mesh(lobeGeom, bodyMat);
    lobeL.position.set(-0.9, 0.4, 0);
    lobeL.scale.set(0.85, 1, 0.9);
    lobeL.castShadow = true;
    g.add(lobeL);

    const lobeR = new THREE.Mesh(lobeGeom, bodyMat);
    lobeR.position.set(0.9, 0.4, 0);
    lobeR.scale.set(0.85, 1, 0.9);
    lobeR.castShadow = true;
    g.add(lobeR);

    // Bottom point of the heart
    const tipGeom = new THREE.ConeGeometry(1.2, 2, 12);
    const tip = new THREE.Mesh(tipGeom, bodyMat);
    tip.position.set(0, -1.6, 0);
    tip.rotation.x = Math.PI;
    tip.castShadow = true;
    g.add(tip);

    // Emissive veins (thin emissive cylinders across the surface)
    const veinMat = new THREE.MeshBasicMaterial({ color: 0xff3010 });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const veinGeom = new THREE.CylinderGeometry(0.04, 0.08, 2.5, 5);
      const vein = new THREE.Mesh(veinGeom, veinMat);
      vein.position.set(Math.cos(a) * 1.2, 0, Math.sin(a) * 1.2);
      vein.rotation.z = Math.cos(a) * 0.5;
      vein.rotation.x = Math.sin(a) * 0.5;
      g.add(vein);
    }

    // Arteries — thick tubes coming out the top
    const artGeom = new THREE.CylinderGeometry(0.2, 0.15, 3, 8);
    const art1 = new THREE.Mesh(artGeom, bodyMat);
    art1.position.set(-0.4, 2.5, 0);
    art1.rotation.z = 0.3;
    g.add(art1);
    const art2 = new THREE.Mesh(artGeom, bodyMat);
    art2.position.set(0.4, 2.5, 0);
    art2.rotation.z = -0.3;
    g.add(art2);

    // Glowing red light at the center
    A.heartLight = new THREE.PointLight(0xff2010, 2, 20);
    A.heartLight.position.set(0, 0, 0);
    g.add(A.heartLight);

    // Position the heart floating above the island
    g.position.set(0, heartY, 0);
    g.userData = { baseY: heartY, pulseT: 0, scaleBase: 1 };
    scene.add(g);
    A.heart = g;
    A.heartPulseT = 0;

    // Add a blood-drop drip system beneath the heart
    A.heartDrips = [];

    console.log('[Act2] Heart built.');
  },

  tickHeart(dt, t) {
    const A = this;
    if (!A.heart) return;
    const u = A.heart.userData;
    u.pulseT += dt;

    // Lub-dub heartbeat: two pumps per cycle
    const cycle = 1.2;  // seconds per heartbeat
    const phase = (u.pulseT % cycle) / cycle;
    let pulse = 0;
    if (phase < 0.12) {
      // Lub (first pump)
      pulse = Math.sin((phase / 0.12) * Math.PI) * 0.18;
    } else if (phase > 0.18 && phase < 0.32) {
      // Dub (second pump)
      pulse = Math.sin(((phase - 0.18) / 0.14) * Math.PI) * 0.14;
    }
    A.heart.scale.setScalar(u.scaleBase + pulse);

    // Light intensity follows the pulse
    if (A.heartLight) {
      A.heartLight.intensity = 1.5 + pulse * 8;
    }

    // Bob up and down slightly
    A.heart.position.y = u.baseY + Math.sin(u.pulseT * 0.8) * 0.15;

    // Camera thump when near
    if (A.nearHeart && pulse > 0.1 && typeof doShake === 'function') {
      doShake(pulse * 0.8, 0.15);
    }

    // Blood drips — spawn periodically
    if (Math.random() < dt * 1.5) {
      A.spawnHeartDrip();
    }
    A.tickHeartDrips(dt);
  },

  spawnHeartDrip() {
    const A = this;
    if (!A.heart) return;
    const dripGeom = new THREE.SphereGeometry(0.12, 6, 5);
    const drip = new THREE.Mesh(dripGeom, new THREE.MeshBasicMaterial({ color: 0xff2010 }));
    const a = Math.random() * Math.PI * 2;
    drip.position.set(
      A.heart.position.x + Math.cos(a) * 0.8,
      A.heart.position.y - 1.5,
      A.heart.position.z + Math.sin(a) * 0.8
    );
    drip.userData = { vy: -2 - Math.random() * 1.5, life: 3 };
    scene.add(drip);
    A.heartDrips.push(drip);
  },

  tickHeartDrips(dt) {
    const A = this;
    for (let i = A.heartDrips.length - 1; i >= 0; i--) {
      const d = A.heartDrips[i];
      d.userData.vy -= 6 * dt;
      d.position.y += d.userData.vy * dt;
      d.userData.life -= dt;
      if (d.position.y < -A.stairMaxDescent + 0.5 || d.userData.life <= 0) {
        scene.remove(d);
        d.geometry.dispose();
        A.heartDrips.splice(i, 1);
      }
    }
  },

  // ============================================================
  // HEADLESS HORSEMAN NPC (05_reaper_scarecrow)
  // ============================================================
  spawnHorseman() {
    const A = this;
    if (A.horseman) return;
    if (typeof THREE.GLTFLoader === 'undefined') return;
    console.log('[Act2] Spawning Headless Horseman...');

    const loader = new THREE.GLTFLoader();
    loader.load('/05_reaper_scarecrow.glb', (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) return;
      const scale = 3.5 / size.y;
      model.scale.setScalar(scale);
      // Position under the dark trees near the plaza (southeast)
      model.position.set(14, -bounds.min.y * scale, 14);
      model.rotation.y = -2.3;
      model.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true;
          if (o.material && o.material.emissive) {
            o.material.emissive.setHex(0x200810);
            o.material.emissiveIntensity = 0.3;
          }
        }
      });

      // Add floating glowing eyes above the model (headless effect)
      const eyeGroup = new THREE.Group();
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff3010 });
      const eye1 = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), eyeMat);
      eye1.position.set(-0.15, 3.2, 0.15);
      const eye2 = eye1.clone();
      eye2.position.x = 0.15;
      eyeGroup.add(eye1);
      eyeGroup.add(eye2);
      model.add(eyeGroup);
      A.horsemanEyes = [eye1, eye2];

      // Add a subtle red glow light
      const eyeLight = new THREE.PointLight(0xff3010, 0.8, 8);
      eyeLight.position.set(0, 3.2, 0.15);
      model.add(eyeLight);

      scene.add(model);
      A.horseman = model;
      A.horsemanBaseYaw = -2.3;
      console.log('[Act2] Horseman spawned.');
    }, undefined, (err) => console.error('[Act2] Horseman load failed:', err));
  },

  tickHorseman(dt, t) {
    const A = this;
    if (!A.horseman) return;
    // Cloak sway
    A.horseman.rotation.z = Math.sin(t * 0.8) * 0.03;
    A.horseman.rotation.y = A.horsemanBaseYaw + Math.sin(t * 0.3) * 0.08;
    // Floating eyes — sin-wave sway + flicker
    const flicker = 0.7 + Math.random() * 0.3;
    A.horsemanEyes.forEach((e, i) => {
      e.position.x = (i ? 0.15 : -0.15) + Math.sin(t * 2 + i) * 0.03;
      e.position.y = 3.2 + Math.sin(t * 1.5) * 0.05;
      e.material.opacity = flicker;
      e.material.transparent = true;
    });
  },

  // ============================================================
  // HEART FEEDING INTERACTION
  // ============================================================
  tryFeedHeart() {
    const A = this;
    if (!A.nearHeart) return false;
    if (typeof send === 'function') send({ t: 'feedHeart' });
    if (typeof AudioSys !== 'undefined') AudioSys.play('buy');
    return true;
  },

  onHeartFed(m) {
    const A = this;
    // The server sends a toast with the blood gained; we just update visuals
    // Big heart pulse + red screen flash
    if (A.heart) {
      A.heart.userData.pulseT = 0;  // restart the heartbeat
      A.heart.scale.setScalar(1.3);
    }
    // Red screen flash
    A.redFlash();
    A.heartFed = m.fed || A.heartFed + 1;
  },

  redFlash() {
    const A = this;
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:#ff2010;opacity:0.4;z-index:600;pointer-events:none;transition:opacity .5s';
    document.body.appendChild(flash);
    setTimeout(() => { flash.style.opacity = '0'; }, 50);
    setTimeout(() => flash.remove(), 700);
  },

  // ============================================================
  // DECIDER CLAIM SCREEN
  // ============================================================
  openDeciderScreen() {
    const A = this;
    if (!A.deciderAvailable || A.deciderClaimed) return;
    const el = document.getElementById('deciderScreen');
    if (!el) return;
    document.getElementById('deciderDrops').textContent = A.fmt(A.bloodDrops);
    const wish = document.getElementById('deciderWish');
    wish.value = '';
    document.getElementById('deciderCount').textContent = '0 / 500';
    el.classList.add('on');
    wish.focus();
  },

  closeDeciderScreen() {
    document.getElementById('deciderScreen').classList.remove('on');
  },

  submitDecider() {
    const A = this;
    const wish = document.getElementById('deciderWish').value.trim();
    if (!wish) {
      if (typeof toast === 'function') toast('Write your wish first!', 'err');
      return;
    }
    if (typeof send === 'function') send({ t: 'buyDecider', wish: wish });
    A.closeDeciderScreen();
  },

  onDeciderClaimed(m) {
    const A = this;
    A.deciderClaimed = true;
    if (typeof toast === 'function') {
      toast('Your wish has been sent. The admins will shape Season 2 with your vision.', 'quest');
    }
  },

  // ============================================================
  // SEASON 2 START GUI (with live 3D turntables)
  // ============================================================
  openS2GUI() {
    const A = this;
    if (A.s2guiOpen) return;
    const el = document.getElementById('s2gui');
    if (!el) return;
    el.classList.add('on');
    A.s2guiOpen = true;
    A.s2gCurrent = 0;
    A.initS2GScene();
    A.showS2GPet(0);
    A.s2gTickLoop();
  },

  closeS2GUI() {
    const A = this;
    document.getElementById('s2gui').classList.remove('on');
    A.s2guiOpen = false;
    if (A.s2gRAF) { cancelAnimationFrame(A.s2gRAF); A.s2gRAF = null; }
  },

  initS2GScene() {
    const A = this;
    if (A.s2gScene) return;
    const canvas = document.getElementById('s2gCanvas');
    A.s2gRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    A.s2gRenderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    A.s2gRenderer.setSize(340, 340);
    A.s2gRenderer.shadowMap.enabled = false;
    A.s2gScene = new THREE.Scene();
    A.s2gCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    A.s2gCamera.position.set(0, 1.5, 6);
    A.s2gCamera.lookAt(0, 1, 0);
    // Lights
    const amb = new THREE.AmbientLight(0x39ff14, 0.3);
    A.s2gScene.add(amb);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 4);
    A.s2gScene.add(key);
    const rim = new THREE.DirectionalLight(0x39ff14, 0.8);
    rim.position.set(-3, 2, -4);
    A.s2gScene.add(rim);
    // Turntable platform
    const platGeom = new THREE.CylinderGeometry(1.5, 1.6, 0.2, 24);
    const platMat = new THREE.MeshLambertMaterial({
      color: 0x1a0a2a, emissive: new THREE.Color(0x0a2010), emissiveIntensity: 0.3
    });
    const plat = new THREE.Mesh(platGeom, platMat);
    plat.position.y = -0.1;
    A.s2gScene.add(plat);
    A.s2gPlatform = plat;
    // Container for the current model
    A.s2gModelGroup = new THREE.Group();
    A.s2gScene.add(A.s2gModelGroup);
    // Build thumbnails
    A.buildS2GThumbs();
  },

  buildS2GThumbs() {
    const A = this;
    const el = document.getElementById('s2gThumbs');
    if (!el) return;
    el.innerHTML = '';
    A.S2_PETS.forEach((pet, i) => {
      const btn = document.createElement('button');
      btn.dataset.idx = i;
      btn.title = pet.name;
      // Use the extracted color texture as the thumbnail
      const img = document.createElement('img');
      img.src = '/' + pet.file.replace('.glb', '_color.png');
      img.onerror = () => { btn.textContent = pet.name.slice(0, 6); };
      btn.appendChild(img);
      btn.onclick = () => A.showS2GPet(i);
      el.appendChild(btn);
    });
  },

  showS2GPet(idx) {
    const A = this;
    if (idx < 0 || idx >= A.S2_PETS.length) return;
    A.s2gCurrent = idx;
    const pet = A.S2_PETS[idx];

    // Update info panel
    document.getElementById('s2gPetName').textContent = pet.name;
    const rarEl = document.getElementById('s2gPetRar');
    rarEl.textContent = pet.rar;
    rarEl.style.background = pet.color;
    document.getElementById('s2gPetLore').textContent = pet.lore;

    // Highlight thumbnail
    document.querySelectorAll('#s2gThumbs button').forEach((b, i) => {
      b.classList.toggle('sel', i === idx);
    });

    // Load the 3D model
    A.loadS2GModel(pet.file);
  },

  loadS2GModel(file) {
    const A = this;
    if (typeof THREE.GLTFLoader === 'undefined') return;
    // Clear previous model
    while (A.s2gModelGroup.children.length) {
      const c = A.s2gModelGroup.children[0];
      A.s2gModelGroup.remove(c);
    }
    const loader = new THREE.GLTFLoader();
    loader.load('/' + file, (gltf) => {
      const model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model);
      const size = bounds.getSize(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) return;
      const scale = 3 / size.y;
      model.scale.setScalar(scale);
      model.position.y = -bounds.min.y * scale;
      model.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
      A.s2gModelGroup.add(model);
      A.s2gCurrentModel = model;
    }, undefined, (err) => console.error('[Act2] S2G model load failed:', err));
  },

  s2gTickLoop() {
    const A = this;
    if (!A.s2guiOpen) return;
    // Rotate the platform + model
    if (A.s2gPlatform) A.s2gPlatform.rotation.y += 0.012;
    if (A.s2gCurrentModel) A.s2gCurrentModel.rotation.y += 0.012;
    if (A.s2gRenderer && A.s2gScene && A.s2gCamera) {
      A.s2gRenderer.render(A.s2gScene, A.s2gCamera);
    }
    A.s2gRAF = requestAnimationFrame(() => A.s2gTickLoop());
  },

  takeS2GPicture() {
    const A = this;
    const canvas = document.getElementById('s2gCanvas');
    if (!canvas) return;
    // Render one frame at high res
    const oldSize = A.s2gRenderer.getSize(new THREE.Vector2());
    A.s2gRenderer.setSize(1024, 1024);
    A.s2gCamera.aspect = 1;
    A.s2gCamera.updateProjectionMatrix();
    A.s2gRenderer.render(A.s2gScene, A.s2gCamera);
    // Download
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'season2-' + A.S2_PETS[A.s2gCurrent].name.replace(/\s/g, '_') + '.png';
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
    // Restore size
    A.s2gRenderer.setSize(340, 340);
    A.s2gCamera.aspect = 1;
    A.s2gCamera.updateProjectionMatrix();
    if (typeof toast === 'function') toast('Picture saved!', 'good');
  },

  // ============================================================
  // ADMIN CONTROL TAB
  // ============================================================
  hookAdminTabs() {
    const A = this;
    // Wait for the admin dash to be opened, then add the Control tab
    if (typeof UI === 'undefined' || !UI.openAdminDash) return;
    const origOpenAdmin = UI.openAdminDash;
    UI.openAdminDash = function () {
      origOpenAdmin.call(this);
      A.injectControlTab();
    };
  },

  injectControlTab() {
    const A = this;
    const tabs = document.getElementById('admTabs');
    if (!tabs) return;
    if (tabs.querySelector('[data-act2="control"]')) return;  // already injected
    const btn = document.createElement('button');
    btn.textContent = 'Control';
    btn.dataset.act2 = 'control';
    btn.onclick = () => {
      [...tabs.children].forEach(x => x.classList.toggle('on', x === btn));
      A.renderControlTab();
    };
    tabs.appendChild(btn);
  },

  renderControlTab() {
    const A = this;
    const el = document.getElementById('admBody');
    if (!el) return;
    const isClosed = !!(A.maintenance && A.maintenance.until > Date.now());

    el.innerHTML = `
      <div class="admCtrlCard">
        <h4>SERVER STATUS</h4>
        <div class="maintStatus">
          <div class="ms"><b id="ctrlStatus">${isClosed ? 'CLOSED' : 'OPEN'}</b><span>Current state</span></div>
          <div class="ms"><b id="ctrlAct2">${A.act2Launched ? 'LAUNCHED' : 'NOT STARTED'}</b><span>Act 2: The Descent</span></div>
        </div>
        ${isClosed ? `
          <div class="admRow" id="ctrlMaintInfo">
            <label>Reason:</label><span id="ctrlReason">${(A.maintenance && A.maintenance.msg) || ''}</span>
          </div>
          <div class="admRow">
            <label>Reopens in:</label><span id="ctrlRemain">--</span>
          </div>
          <button class="openServerBtn" id="ctrlOpen">OPEN SERVER NOW</button>
        ` : `
          <button class="closeServerBtn" id="ctrlClose">CLOSE SERVER</button>
        `}
      </div>

      <div class="admCtrlCard" id="ctrlCloseCard" style="${isClosed ? 'display:none' : ''}">
        <h4>CLOSE FOR MAINTENANCE</h4>
        <div class="admRow">
          <label>Reason</label>
          <input id="ctrlMsg" style="flex:1;min-width:280px" placeholder="e.g. Fixing the blood lake collision" maxlength="200">
        </div>
        <div class="admRow">
          <label>What you're fixing</label>
          <input id="ctrlFix" style="flex:1;min-width:280px" placeholder="e.g. Heart feed distance check" maxlength="200">
        </div>
        <div class="admRow">
          <label>Duration</label>
        </div>
        <div class="durBtns" id="ctrlDurBtns">
          <button data-min="5">5 min</button>
          <button data-min="15">15 min</button>
          <button data-min="30" class="sel">30 min</button>
          <button data-min="60">1 hour</button>
          <button data-min="0">Custom</button>
        </div>
        <div class="admRow" id="ctrlCustomDur" style="display:none">
          <label>Custom (min)</label>
          <input id="ctrlCustomMin" type="number" value="30" min="1" max="720" style="width:120px">
        </div>
        <button class="closeServerBtn" id="ctrlConfirm" style="margin-top:14px">CONFIRM — CLOSE SERVER</button>
      </div>

      <div class="admCtrlCard">
        <h4>SEASON 1 ACT 2 — THE DESCENT</h4>
        <div class="desc" style="font-size:12px;color:#7c8a98;margin-bottom:14px">
          Launch the island-cracking event. A spiral staircase opens at the plaza edge, leading down to the Living Heart.
          Players feed fruit to earn Blood Drops. First to 1B drops claims the Season Decider.
        </div>
        <button class="btnSm btnA" id="ctrlAct2Btn" ${A.act2Launched ? 'disabled' : ''}>
          ${A.act2Launched ? 'ACT 2 ALREADY LAUNCHED' : 'LAUNCH ACT 2 NOW'}
        </button>
      </div>

      <div class="admCtrlCard">
        <h4>SEASON DECIDER — WISH INBOX</h4>
        <div class="desc" style="font-size:12px;color:#7c8a98;margin-bottom:14px">
          When a player claims the Decider, their wish for Season 2 appears here.
        </div>
        <div id="ctrlWishes"><p style="color:#6a7885;font-size:13px">Loading wishes...</p></div>
        <button class="btnSm btnGhost" id="ctrlRefreshWishes" style="margin-top:8px">Refresh</button>
      </div>
    `;

    // Bindings
    let selectedDur = 30;
    el.querySelectorAll('#ctrlDurBtns button').forEach(b => {
      b.onclick = () => {
        el.querySelectorAll('#ctrlDurBtns button').forEach(x => x.classList.remove('sel'));
        b.classList.add('sel');
        selectedDur = +b.dataset.min;
        document.getElementById('ctrlCustomDur').style.display = (selectedDur === 0) ? 'flex' : 'none';
      };
    });

    const confirmBtn = document.getElementById('ctrlConfirm');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        const msg = document.getElementById('ctrlMsg').value.trim() || 'We are working on the island.';
        const fix = document.getElementById('ctrlFix').value.trim();
        const mins = selectedDur === 0
          ? Math.max(1, +document.getElementById('ctrlCustomMin').value || 30)
          : selectedDur;
        if (!confirm(`Close the server for ${mins} minutes?\nReason: ${msg}`)) return;
        if (typeof send === 'function' && typeof ST !== 'undefined' && ST.adminToken) {
          send({ t: 'admin', token: ST.adminToken, cmd: 'closeGame', args: { minutes: mins, msg, fix } });
        }
      };
    }

    const openBtn = document.getElementById('ctrlOpen');
    if (openBtn) {
      openBtn.onclick = () => {
        if (!confirm('Open the server now?')) return;
        if (typeof send === 'function' && ST.adminToken) {
          send({ t: 'admin', token: ST.adminToken, cmd: 'openServer', args: {} });
        }
      };
    }

    const act2Btn = document.getElementById('ctrlAct2Btn');
    if (act2Btn) {
      act2Btn.onclick = () => {
        if (A.act2Launched) return;
        if (!confirm('LAUNCH ACT 2: THE DESCENT for ALL players?\n\nThe island will crack open. A spiral staircase appears at the plaza edge. The Living Heart awakens in the cavern below.')) return;
        if (typeof send === 'function' && ST.adminToken) {
          send({ t: 'admin', token: ST.adminToken, cmd: 'launchAct2', args: {} });
        }
      };
    }

    const refreshBtn = document.getElementById('ctrlRefreshWishes');
    if (refreshBtn) {
      refreshBtn.onclick = () => {
        if (typeof send === 'function' && ST.adminToken) {
          send({ t: 'admin', token: ST.adminToken, cmd: 'getDeciderWishes', args: {} });
        }
      };
    }
    // Auto-load wishes
    if (typeof send === 'function' && ST && ST.adminToken) {
      send({ t: 'admin', token: ST.adminToken, cmd: 'getDeciderWishes', args: {} });
    }

    // If closed, tick the remaining-time display
    if (isClosed) A.tickControlRemaining();
  },

  tickControlRemaining() {
    const A = this;
    if (!A.maintenance || !A.maintenance.active) return;
    const el = document.getElementById('ctrlRemain');
    if (!el) return;
    const rem = Math.max(0, A.maintenance.until - Date.now());
    const min = Math.floor(rem / 60000);
    const sec = Math.floor((rem % 60000) / 1000);
    el.textContent = min + ':' + String(sec).padStart(2, '0');
    if (rem <= 0) { A.renderControlTab(); return; }
    setTimeout(() => A.tickControlRemaining(), 1000);
  },

  renderDeciderWishes(wishes) {
    const A = this;
    const el = document.getElementById('ctrlWishes');
    if (!el) return;
    if (!wishes || !wishes.length) {
      el.innerHTML = '<p style="color:#6a7885;font-size:13px">No wishes yet. When a player claims the Decider, their wish appears here.</p>';
      return;
    }
    el.innerHTML = wishes.map(w => `
      <div class="deciderWishRow">
        <div class="pName">${w.name}</div>
        <div class="pWish">${(w.wish || '').replace(/</g, '&lt;')}</div>
        <div class="pTime">${new Date(w.at).toLocaleString()}</div>
        <button class="btnSm btnGhost" data-clear="${w.player}">Dismiss</button>
      </div>
    `).join('');
    el.querySelectorAll('button[data-clear]').forEach(b => {
      b.onclick = () => {
        if (typeof send === 'function' && ST.adminToken) {
          send({ t: 'admin', token: ST.adminToken, cmd: 'clearDeciderWish', args: { targetId: b.dataset.clear } });
        }
      };
    });
  },

  // ============================================================
  // UI BINDINGS
  // ============================================================
  bindUI() {
    const A = this;
    // Decider submit
    const ds = document.getElementById('deciderSubmit');
    if (ds) ds.onclick = () => A.submitDecider();
    const dw = document.getElementById('deciderWish');
    if (dw) dw.oninput = () => {
      document.getElementById('deciderCount').textContent = dw.value.length + ' / 500';
    };

    // S2 GUI buttons
    const s2gPic = document.getElementById('s2gPic');
    if (s2gPic) s2gPic.onclick = () => A.takeS2GPicture();
    const s2gClose = document.getElementById('s2gClose');
    if (s2gClose) s2gClose.onclick = () => A.closeS2GUI();

    // Hook into the interact key (E) for heart feeding + horseman
    const origTryInteract = window.tryInteract;
    if (origTryInteract) {
      window.tryInteract = function () {
        // Check horseman first (opens S2 GUI)
        if (A.nearHorseman) {
          A.openS2GUI();
          if (typeof AudioSys !== 'undefined') AudioSys.play('click');
          return;
        }
        // Check heart
        if (A.nearHeart) {
          A.tryFeedHeart();
          return;
        }
        // Check decider availability
        if (A.deciderAvailable && !A.deciderClaimed) {
          A.openDeciderScreen();
          return;
        }
        origTryInteract();
      };
    }
  },

  // ============================================================
  // TICK LOOP — runs alongside the main animate()
  // ============================================================
  tickLoop() {
    const A = this;
    const tick = (t_ms) => {
      const t = t_ms / 1000;
      const dt = Math.min(0.05, (t_ms - (A._lastT || t_ms)) / 1000);
      A._lastT = t_ms;

      // Tick 3D objects
      A.tickHeart(dt, t);
      A.tickHorseman(dt, t);
      A.tickCavernDrips(dt, t);
      A.tickStairFog(dt, t);
      A.tickStairRim(t);

      // Check proximity to heart + horseman
      A.checkProximity();

      // Update prompt
      A.updatePrompt();

      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },

  tickCavernDrips(dt, t) {
    const A = this;
    if (!A.cavernDrips) return;
    const { points, vel, floorY } = A.cavernDrips;
    const pos = points.geometry.attributes.position.array;
    for (let i = 0; i < vel.length; i++) {
      pos[i * 3 + 1] += vel[i].vy * dt;
      if (pos[i * 3 + 1] < floorY + 0.3) {
        // Reset to ceiling
        pos[i * 3 + 1] = -2;
        vel[i].vy = -1 - Math.random() * 2;
      }
    }
    points.geometry.attributes.position.needsUpdate = true;
  },

  tickStairFog(dt, t) {
    const A = this;
    if (!A.stairFog) return;
    const pos = A.stairFog.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] += dt * 0.5;  // drift up
      if (pos[i + 1] > 0) pos[i + 1] = -A.stairMaxDescent;  // reset to bottom
    }
    A.stairFog.geometry.attributes.position.needsUpdate = true;
  },

  tickStairRim(t) {
    const A = this;
    if (!A.stairRim) return;
    A.stairRim.material.color.setHSL(0, 1, 0.5 + Math.sin(t * 3) * 0.15);
  },

  // ============================================================
  // PROXIMITY CHECKS
  // ============================================================
  checkProximity() {
    const A = this;
    if (typeof player === 'undefined' || !player) return;

    // Heart proximity
    A.nearHeart = false;
    if (A.heart && A.act2Launched) {
      const dx = player.x - A.heart.position.x;
      const dz = player.z - A.heart.position.z;
      const dy = player.y - A.heart.position.y;
      const d = Math.hypot(dx, dy, dz);
      A.nearHeart = (d < 5 && player.y < -20);
    }

    // Horseman proximity
    A.nearHorseman = false;
    if (A.horseman && A.act2Launched) {
      const dx = player.x - A.horseman.position.x;
      const dz = player.z - A.horseman.position.z;
      const d = Math.hypot(dx, dz);
      A.nearHorseman = (d < 4 && player.y > -5);
    }

    // Decider availability — show prompt when near heart AND have enough drops
    A.canClaimDecider = A.deciderAvailable && !A.deciderClaimed && A.bloodDrops >= 1000000000 && A.nearHeart;
  },

  updatePrompt() {
    const A = this;
    const el = document.getElementById('act2Prompt');
    if (!el) return;
    let txt = '';
    if (A.nearHeart && A.act2Launched) {
      if (A.canClaimDecider) {
        txt = '<b>[E]</b> CLAIM THE SEASON DECIDER';
      } else if (typeof ST !== 'undefined' && ST.me && ST.me.produce && ST.me.produce.length) {
        txt = '<b>[E]</b> Feed the Heart';
      } else {
        txt = 'The Heart hunger... bring harvested fruit';
      }
    } else if (A.nearHorseman) {
      txt = '<b>[E]</b> Speak to the Headless Horseman';
    }
    if (txt) {
      el.innerHTML = txt;
      el.classList.add('on');
    } else {
      el.classList.remove('on');
    }
  },
};

// ============================================================
// BOOT — self-initialize when the DOM is ready
// ============================================================
(function () {
  function boot() {
    // Wait until the main script has run (THREE, ST, handleNet exist)
    // Note: ST and handleNet are top-level declarations in the inline script.
    // They're in the shared global scope but NOT on window (const/function decl behavior).
    // So we check them directly via typeof (safe against ReferenceError).
    try {
      if (typeof THREE === 'undefined') throw 'THREE';
      if (typeof handleNet !== 'function') throw 'handleNet';
      if (typeof ST === 'undefined') throw 'ST';
    } catch (e) {
      setTimeout(boot, 50);
      return;
    }
    Act2.init();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
