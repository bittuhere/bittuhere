const fs = require('fs');

const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, maximum-scale=1.0">
    <title>BitArcade Endless Runner</title>
    <style>
        body { margin: 0; overflow: hidden; background: #000; touch-action: none; font-family: 'Courier New', Courier, monospace; }
        canvas { display: block; }
        #ui { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
        .hud { padding: 20px; color: #fff; font-size: 24px; font-weight: bold; text-shadow: 2px 2px 0 #000; display: flex; justify-content: space-between; }
        #gameover { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #fff; text-align: center; display: none; background: rgba(0,0,0,0.8); padding: 40px; border-radius: 10px; pointer-events: auto; }
        #gameover h1 { margin: 0 0 20px 0; color: #ff0055; font-size: 48px; text-transform: uppercase; }
        button { padding: 15px 30px; font-size: 20px; font-weight: bold; background: #ff0055; color: #fff; border: none; border-radius: 5px; cursor: pointer; text-transform: uppercase; }
        button:active { transform: scale(0.95); }
        #loading { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); color: #00ffff; font-size: 24px; font-weight: bold; }
        .powerup-indicator { position: absolute; bottom: 20px; left: 20px; color: #fff; font-size: 20px; font-weight: bold; }
    </style>
    <!-- Import maps polyfill -->
    <script async src="https://unpkg.com/es-module-shims@1.8.0/dist/es-module-shims.js"></script>
    <script type="importmap">
        {
            "imports": {
                "three": "https://unpkg.com/three@0.160.0/build/three.module.js",
                "three/addons/": "https://unpkg.com/three@0.160.0/examples/jsm/"
            }
        }
    </script>
</head>
<body>
    <div id="ui">
        <div class="hud">
            <div id="scoreDisplay">Score: 0</div>
            <div id="coinsDisplay">Coins: 0</div>
        </div>
        <div class="powerup-indicator" id="powerupDisplay"></div>
        <div id="loading">Loading Assets...</div>
        <div id="gameover">
            <h1>Game Over</h1>
            <p id="finalScore" style="font-size: 24px; margin-bottom: 20px;">Score: 0</p>
            <button onclick="location.reload()">Play Again</button>
        </div>
    </div>

    <script type="module">
        import * as THREE from 'three';
        import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

        // --- Game Config & State ---
        const config = {
            laneWidth: 3.5,
            gravity: 150,
            jumpStrength: 35,
            initialSpeed: 20,
            acceleration: 0.5,
            maxSpeed: 60
        };

        const state = {
            running: false,
            score: 0,
            coins: 0,
            speed: config.initialSpeed,
            lane: 0, // -1: left, 0: center, 1: right
            velocityY: 0,
            stumbles: 0,
            isJumping: false,
            powerup: 'normal', // 'normal', 'jetpack', 'magnet', 'sneakers'
            powerupTimer: 0,
            isShielded: false, // Hoverboard state
            distance: 0
        };

        // --- Setup Scene, Camera, Renderer ---
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x87ceeb); // Urban Pop Art sky color
        scene.fog = new THREE.Fog(0xffa500, 20, 150); // High saturation fog for depth

        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200);
        camera.position.set(0, 5, 12);
        camera.lookAt(0, 2, -10);

        const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        document.body.appendChild(renderer.domElement);

        // --- Lighting ---
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(10, 20, 10);
        dirLight.castShadow = true;
        dirLight.shadow.camera.top = 20;
        dirLight.shadow.camera.bottom = -20;
        dirLight.shadow.camera.left = -20;
        dirLight.shadow.camera.right = 20;
        scene.add(dirLight);

        // --- Environment (Procedural Tracks) ---
        function createTrackTexture() {
            const canvas = document.createElement('canvas');
            canvas.width = 512;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');

            // Base ground
            ctx.fillStyle = '#222';
            ctx.fillRect(0, 0, 512, 512);

            // Sleepers (wood)
            ctx.fillStyle = '#5c4033';
            for(let i=0; i<4; i++) {
                ctx.fillRect(0, i*128 + 40, 512, 48);
            }

            // Rails (metal)
            ctx.fillStyle = '#aaa';
            const laneWidthPx = 512 / 3;
            for(let l=0; l<3; l++) {
                const cx = (l + 0.5) * laneWidthPx;
                ctx.fillRect(cx - 30, 0, 10, 512);
                ctx.fillRect(cx + 20, 0, 10, 512);
            }

            const tex = new THREE.CanvasTexture(canvas);
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
            tex.repeat.set(3, 20); // Scale tracks
            return tex;
        }

        const trackGeo = new THREE.PlaneGeometry(30, 300);
        const trackMat = new THREE.MeshStandardMaterial({
            map: createTrackTexture(),
            roughness: 0.8
        });
        const track = new THREE.Mesh(trackGeo, trackMat);
        track.rotation.x = -Math.PI / 2;
        track.position.z = -100;
        track.receiveShadow = true;
        scene.add(track);

        // --- Object Pools & Generation ---
        const activeObjects = [];
        const pools = {
            trains: [],
            barriers: [],
            coins: [],
            powerups: []
        };

        function createTrain() {
            const group = new THREE.Group();

            // Train Body (High metalness)
            const bodyGeo = new THREE.BoxGeometry(2.8, 4, 10);
            const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff4400, metalness: 0.8, roughness: 0.2 });
            const body = new THREE.Mesh(bodyGeo, bodyMat);
            body.position.y = 2;
            body.castShadow = true;
            body.receiveShadow = true;
            group.add(body);

            // Front Glass
            const glassGeo = new THREE.PlaneGeometry(2.6, 2);
            const glassMat = new THREE.MeshPhysicalMaterial({
                color: 0x000000, metalness: 0.9, roughness: 0.1, transmission: 0.5, transparent: true
            });
            const glass = new THREE.Mesh(glassGeo, glassMat);
            glass.position.set(0, 2.5, 5.01);
            group.add(glass);

            // Headlights
            const lightGeo = new THREE.CircleGeometry(0.3, 16);
            const lightMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
            for(let i of [-1, 1]) {
                const lightMesh = new THREE.Mesh(lightGeo, lightMat);
                lightMesh.position.set(i * 0.8, 1, 5.01);
                group.add(lightMesh);

                const spotLight = new THREE.SpotLight(0xffff00, 2, 20, Math.PI/6, 0.5, 1);
                spotLight.position.set(i * 0.8, 1, 5.01);
                spotLight.target.position.set(i * 0.8, 0, 20);
                group.add(spotLight);
                group.add(spotLight.target);
            }

            group.userData = { type: 'train', active: false, hitbox: new THREE.Box3() };
            return group;
        }

        function createBarrier() {
            const geo = new THREE.BoxGeometry(2.8, 1.5, 0.5);
            const mat = new THREE.MeshStandardMaterial({ color: 0xffaa00, map: createStripes() });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.y = 0.75;
            mesh.castShadow = true;
            mesh.userData = { type: 'barrier', active: false, hitbox: new THREE.Box3() };
            return mesh;
        }

        function createStripes() {
            const c = document.createElement('canvas');
            c.width = 128; c.height = 128;
            const ctx = c.getContext('2d');
            ctx.fillStyle = '#ffaa00';
            ctx.fillRect(0, 0, 128, 128);
            ctx.fillStyle = '#000';
            for(let i=0; i<128; i+=32) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i+16, 0);
                ctx.lineTo(0, i+16);
                ctx.lineTo(0, i);
                ctx.fill();
            }
            return new THREE.CanvasTexture(c);
        }

        function createCoin() {
            const geo = new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16);
            const mat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 1.0, roughness: 0.1 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = Math.PI / 2;
            mesh.position.y = 1;
            mesh.castShadow = true;
            mesh.userData = { type: 'coin', active: false, hitbox: new THREE.Box3() };
            return mesh;
        }

        function createPowerup(type) {
            const group = new THREE.Group();
            let mesh;
            if(type === 'magnet') {
                mesh = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.15, 8, 16, Math.PI), new THREE.MeshStandardMaterial({color: 0xff0000}));
            } else if(type === 'sneakers') {
                mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshStandardMaterial({color: 0x0055ff}));
            } else if(type === 'jetpack') {
                mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1), new THREE.MeshStandardMaterial({color: 0x55ff55}));
            } else { // shield/hoverboard
                mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.1, 2), new THREE.MeshStandardMaterial({color: 0xff00ff}));
            }
            mesh.position.y = 1;
            group.add(mesh);
            group.userData = { type: 'powerup', powerType: type, active: false, hitbox: new THREE.Box3() };
            return group;
        }

        // Initialize Pools
        for(let i=0; i<10; i++) pools.trains.push(createTrain());
        for(let i=0; i<15; i++) pools.barriers.push(createBarrier());
        for(let i=0; i<50; i++) pools.coins.push(createCoin());
        ['magnet', 'sneakers', 'jetpack', 'shield'].forEach(t => {
            for(let i=0; i<2; i++) pools.powerups.push(createPowerup(t));
        });

        function spawnObject(poolArray, lane, zOffset) {
            const obj = poolArray.find(o => !o.userData.active);
            if(obj) {
                obj.userData.active = true;
                obj.position.set(lane * config.laneWidth, 0, zOffset);
                if(obj.userData.type === 'coin') obj.position.y = 1; // Default height
                scene.add(obj);
                activeObjects.push(obj);
            }
            return obj;
        }

        let nextSpawnZ = -30;
        function generateWorld() {
            if(nextSpawnZ > -20) return; // Keep generation ahead

            const lane = Math.floor(Math.random() * 3) - 1;
            const r = Math.random();

            if(r < 0.2) {
                // Spawn Train
                spawnObject(pools.trains, lane, nextSpawnZ);
            } else if(r < 0.4) {
                // Spawn Barrier
                spawnObject(pools.barriers, lane, nextSpawnZ);
                // Maybe a coin above the barrier
                const coin = spawnObject(pools.coins, lane, nextSpawnZ);
                if(coin) coin.position.y = 3;
            } else if(r < 0.8) {
                // Line of coins
                for(let i=0; i<5; i++) {
                    spawnObject(pools.coins, lane, nextSpawnZ - i * 2);
                }
                nextSpawnZ -= 10;
            } else {
                // Powerup
                const types = ['magnet', 'sneakers', 'jetpack', 'shield'];
                const pType = types[Math.floor(Math.random() * types.length)];
                const pPool = pools.powerups.filter(p => p.userData.powerType === pType);
                spawnObject(pPool, lane, nextSpawnZ);
            }

            nextSpawnZ -= 15 + Math.random() * 20;
        }

        // --- Character Setup ---
        let playerMixer, inspectorMixer;
        let playerActions = {}, inspectorActions = {};
        const playerGroup = new THREE.Group();
        const inspectorGroup = new THREE.Group();
        scene.add(playerGroup);
        scene.add(inspectorGroup);

        let playerModel, inspectorModel;
        const playerBox = new THREE.Box3();

        // Load GLTF
        const loader = new GLTFLoader();
        // Using RobotExpressive as requested
        loader.load('https://cdn.jsdelivr.net/gh/mrdoob/three.js@master/examples/models/gltf/RobotExpressive/RobotExpressive.glb', (gltf) => {
            playerModel = gltf.scene;
            playerModel.scale.set(0.5, 0.5, 0.5);
            playerModel.rotation.y = Math.PI; // Face away
            playerModel.traverse(c => { if(c.isMesh) { c.castShadow = true; c.receiveShadow = true; }});
            playerGroup.add(playerModel);

            playerMixer = new THREE.AnimationMixer(playerModel);
            gltf.animations.forEach(clip => {
                playerActions[clip.name] = playerMixer.clipAction(clip);
            });
            playerActions['Running']?.play();

            // Inspector (Clone and color dark)
            inspectorModel = playerModel.clone();
            inspectorModel.traverse(c => {
                if(c.isMesh) {
                    c.material = c.material.clone();
                    c.material.color.setHex(0x222222);
                }
            });
            inspectorGroup.add(inspectorModel);
            inspectorMixer = new THREE.AnimationMixer(inspectorModel);
            gltf.animations.forEach(clip => {
                inspectorActions[clip.name] = inspectorMixer.clipAction(clip);
            });
            inspectorActions['Running']?.play();
            inspectorGroup.position.set(0, 0, 15); // Hidden initially

            document.getElementById('loading').style.display = 'none';
            startGame();
        });

        // --- Input Handling ---
        let startX, startY;
        window.addEventListener('touchstart', e => {
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
        }, {passive: false});

        window.addEventListener('touchend', e => {
            if(!state.running) return;
            const endX = e.changedTouches[0].clientX;
            const endY = e.changedTouches[0].clientY;
            handleSwipe(endX - startX, endY - startY);
        }, {passive: false});

        window.addEventListener('keydown', e => {
            if(!state.running) return;
            if(e.key === 'ArrowLeft' || e.key === 'a') moveLane(-1);
            if(e.key === 'ArrowRight' || e.key === 'd') moveLane(1);
            if(e.key === 'ArrowUp' || e.key === 'w' || e.key === ' ') jump();
            if(e.key === 'ArrowDown' || e.key === 's') roll();
        });

        function handleSwipe(dx, dy) {
            if(Math.abs(dx) > Math.abs(dy)) {
                if(dx > 30) moveLane(1);
                else if(dx < -30) moveLane(-1);
            } else {
                if(dy < -30) jump();
                else if(dy > 30) roll();
            }
        }

        function moveLane(dir) {
            state.lane = Math.max(-1, Math.min(1, state.lane + dir));
        }

        function jump() {
            if(!state.isJumping || state.powerup === 'jetpack') {
                const mult = state.powerup === 'sneakers' ? 1.5 : 1;
                state.velocityY = config.jumpStrength * mult;
                state.isJumping = true;
                if(playerActions['Jump']) {
                    playerActions['Running']?.stop();
                    playerActions['Jump']?.reset().play();
                }
            }
        }

        function roll() {
            // Rapid fall if in air
            if(state.isJumping) state.velocityY = -config.jumpStrength;
        }

        // --- Game Logic ---
        function startGame() {
            state.running = true;
            state.score = 0;
            state.coins = 0;
            state.speed = config.initialSpeed;
            state.stumbles = 0;
            state.lane = 0;
            state.powerup = 'normal';
            state.isShielded = false;
            playerGroup.position.set(0, 0, 0);
            inspectorGroup.position.set(0, 0, 15);
            document.getElementById('gameover').style.display = 'none';

            // Clear objects
            activeObjects.forEach(obj => {
                obj.userData.active = false;
                scene.remove(obj);
            });
            activeObjects.length = 0;
            nextSpawnZ = -30;

            updateHUD();
        }

        function gameOver() {
            state.running = false;
            document.getElementById('finalScore').innerText = "Score: " + Math.floor(state.score);
            document.getElementById('gameover').style.display = 'block';
            playerActions['Running']?.stop();
            playerActions['Death']?.reset().play(); // If exists
        }

        function applyStumble() {
            if(state.isShielded) {
                state.isShielded = false; // consume shield
                return;
            }
            state.stumbles++;
            if(state.stumbles >= 2) {
                gameOver();
            } else {
                inspectorGroup.position.z = 5; // Close in
                setTimeout(() => {
                    if(state.running) inspectorGroup.position.z = 15; // Fall back after a while
                    state.stumbles = 0;
                }, 5000);
            }
        }

        function updateHUD() {
            document.getElementById('scoreDisplay').innerText = "Score: " + Math.floor(state.score);
            document.getElementById('coinsDisplay').innerText = "Coins: " + state.coins;
            let pText = "";
            if(state.powerupTimer > 0) pText += state.powerup.toUpperCase() + " " + Math.ceil(state.powerupTimer) + "s ";
            if(state.isShielded) pText += "[SHIELDED]";
            document.getElementById('powerupDisplay').innerText = pText;
        }

        // --- Main Loop ---
        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const delta = Math.min(clock.getDelta(), 0.1);

            if(playerMixer) playerMixer.update(delta);
            if(inspectorMixer) inspectorMixer.update(delta);

            if(!state.running) {
                renderer.render(scene, camera);
                return;
            }

            // Increase speed
            state.speed = Math.min(config.maxSpeed, state.speed + config.acceleration * delta);
            state.score += state.speed * delta * 0.1;

            // Powerup logic
            if(state.powerupTimer > 0) {
                state.powerupTimer -= delta;
                if(state.powerupTimer <= 0) {
                    state.powerup = 'normal';
                }
            }

            // Physics & Movement
            // Snappy Lane Transition
            const targetX = state.lane * config.laneWidth;
            playerGroup.position.x = THREE.MathUtils.lerp(playerGroup.position.x, targetX, 15 * delta);

            // Snappy Gravity
            if(state.powerup === 'jetpack') {
                state.velocityY = 0;
                playerGroup.position.y = THREE.MathUtils.lerp(playerGroup.position.y, 8, 5 * delta);
                state.isJumping = true; // Prevents jumping while flying
            } else {
                state.velocityY -= config.gravity * delta;
                playerGroup.position.y += state.velocityY * delta;

                if(playerGroup.position.y <= 0) {
                    playerGroup.position.y = 0;
                    state.velocityY = 0;
                    if(state.isJumping) {
                        state.isJumping = false;
                        if(playerActions['Jump']) playerActions['Jump'].stop();
                        playerActions['Running']?.play();
                    }
                }
            }

            // Update Player Hitbox
            playerBox.setFromObject(playerModel);
            // Shrink hitbox slightly for forgiveness
            playerBox.expandByScalar(-0.2);

            // Move Environment Texture
            trackMat.map.offset.y -= state.speed * delta * 0.05;

            // Generate World
            nextSpawnZ += state.speed * delta;
            generateWorld();

            // Update Objects & Collisions
            for(let i = activeObjects.length - 1; i >= 0; i--) {
                const obj = activeObjects[i];
                obj.position.z += state.speed * delta;

                // Animation (rotate coins)
                if(obj.userData.type === 'coin') obj.rotation.y += 5 * delta;
                if(obj.userData.type === 'powerup') obj.rotation.y += 2 * delta;

                // Magnet logic
                if(state.powerup === 'magnet' && obj.userData.type === 'coin') {
                    const dist = obj.position.distanceTo(playerGroup.position);
                    if(dist < 15) {
                        obj.position.lerp(playerGroup.position, 10 * delta);
                    }
                }

                // Update hitbox
                obj.userData.hitbox.setFromObject(obj);

                // Collision Detection
                if(playerBox.intersectsBox(obj.userData.hitbox)) {
                    if(obj.userData.type === 'coin') {
                        state.coins++;
                        obj.userData.active = false;
                        scene.remove(obj);
                        activeObjects.splice(i, 1);
                    } else if(obj.userData.type === 'powerup') {
                        const pt = obj.userData.powerType;
                        if(pt === 'shield') state.isShielded = true;
                        else {
                            state.powerup = pt;
                            state.powerupTimer = 10; // 10 seconds duration
                        }
                        obj.userData.active = false;
                        scene.remove(obj);
                        activeObjects.splice(i, 1);
                    } else if(obj.userData.type === 'train') {
                        if(state.isShielded) {
                            state.isShielded = false;
                            obj.userData.active = false;
                            scene.remove(obj);
                            activeObjects.splice(i, 1);
                        } else {
                            gameOver();
                        }
                    } else if(obj.userData.type === 'barrier') {
                        applyStumble();
                        obj.userData.active = false;
                        scene.remove(obj);
                        activeObjects.splice(i, 1);
                    }
                }

                // Remove passed objects
                else if(obj.position.z > 20) {
                    obj.userData.active = false;
                    scene.remove(obj);
                    activeObjects.splice(i, 1);
                }
            }

            // Inspector follow
            if(state.stumbles === 1) {
                inspectorGroup.position.x = THREE.MathUtils.lerp(inspectorGroup.position.x, playerGroup.position.x, 5 * delta);
            }

            updateHUD();
            renderer.render(scene, camera);
        }

        animate();

        // Handle Resize
        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

    </script>
</body>
</html>
`

fs.writeFileSync('runner.html', htmlContent);
console.log('runner.html generated');
