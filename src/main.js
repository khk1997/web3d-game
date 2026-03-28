import "./style.css";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";

const app = document.querySelector("#app");

app.innerHTML = `
  <section class="hud">
    <div class="hud__cluster hud__cluster--left">
      <div class="hud__card hud__card--title">
        <p class="eyebrow">Stylized Driving Prototype</p>
        <h1>Road Trip Playground</h1>
        <p class="lede">開著小車在世界裡逛，撞撞看、繞圈看、找喜歡的視角。</p>
        <div class="hud__pills">
          <span class="hud__pill">Prototype Build</span>
          <span class="hud__pill">Physics Sandbox</span>
        </div>
      </div>
      <div class="hud__card hud__card--controls">
        <p class="hud__section-title">Controls</p>
        <p><strong>W / ↑</strong> 加速</p>
        <p><strong>S / ↓</strong> 倒車</p>
        <p><strong>A D / ← →</strong> 轉向</p>
        <p><strong>R</strong> 重設車輛</p>
        <p><strong>滑鼠拖曳</strong> 環看鏡頭</p>
      </div>
      <div class="hud__card hud__card--tips">
        <p class="hud__section-title">Handling Notes</p>
        <p>現在這版先專注測試車輛與物理手感。</p>
        <p>場景元素之後會再慢慢疊回來。</p>
      </div>
    </div>
    <div class="hud__cluster hud__cluster--right">
      <div class="hud__card hud__card--status">
        <p class="hud__section-title">Drive Feed</p>
        <p id="speed-readout">Speed 0 km/h</p>
        <p id="hint-readout">試著穿過拱門、繞過柱子，再衝上斜坡。</p>
      </div>
      <div class="hud__card hud__card--objectives">
        <p class="hud__section-title">Things To Try</p>
        <p>穿過紅色拱門</p>
        <p>衝上左側斜坡</p>
        <p>繞外圈完整一圈</p>
      </div>
      <div class="hud__meter">
        <span class="hud__meter-label">Speed</span>
        <div class="hud__meter-track">
          <div class="hud__meter-fill" id="speed-meter-fill"></div>
        </div>
      </div>
    </div>
  </section>
  <button class="start-button" type="button">Start Driving</button>
  <div class="loading">Initializing world...</div>
`;

const loadingLabel = document.querySelector(".loading");
const startButton = document.querySelector(".start-button");
const speedReadout = document.querySelector("#speed-readout");
const hintReadout = document.querySelector("#hint-readout");
const objectivesCard = document.querySelector(".hud__card--objectives");
const speedMeterFill = document.querySelector("#speed-meter-fill");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xfff2d6);
scene.fog = new THREE.Fog(0xfff2d6, 28, 72);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 220);
camera.position.set(0, 5, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const worldRoot = new THREE.Group();
scene.add(worldRoot);

const clock = new THREE.Clock();
const keys = new Set();
const pointer = {
  active: false,
  startX: 0,
  startY: 0,
  yaw: 0.55,
  pitch: 0.32,
};

let rapierWorld;
let vehicleBody;
let vehicleMesh;
let wheelMeshes = [];
let frontWheelPivots = [];
let pushableBodies = [];
let dynamicSceneBodies = [];
let steeringAngle = 0;
let driveSpeed = 0;

const cameraTarget = new THREE.Vector3();
const cameraPosition = new THREE.Vector3();
const vehicleForward = new THREE.Vector3();
const vehiclePosition = new THREE.Vector3();
const resetPosition = new THREE.Vector3(0, 2.2, 0);
const chaseOffset = new THREE.Vector3();
const accelerationVector = new THREE.Vector3();
const lateralAxis = new THREE.Vector3();

const vehicleTuning = {
  maxSteerAngle: 0.52,
  steerResponse: 0.18,
  steerReturn: 0.12,
  forwardAcceleration: 22,
  reverseAcceleration: 22,
  idleDrag: 0.985,
  lateralGrip: 0.22,
  coastGrip: 0.1,
  wheelBase: 2.35,
  reverseYawScale: 1,
  maxYawRate: 2.9,
  maxForwardSpeed: 12,
  maxReverseSpeed: 10,
};

const palette = {
  sky: 0xfff2d6,
  grass: 0x8fce65,
  accent: 0xf25f5c,
  teal: 0x4ecdc4,
  cream: 0xfff7eb,
};

function createRoundedBox(width, height, depth, radius, color) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: radius * 0.45,
    bevelThickness: radius * 0.45,
    curveSegments: 8,
  });
  geometry.center();

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0.03 })
  );
}

function buildWorldDecor() {
  const ambientLight = new THREE.HemisphereLight(0xfff9ef, 0x46704c, 1.4);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfff3cf, 2.8);
  sunLight.position.set(16, 22, 10);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -35;
  sunLight.shadow.camera.right = 35;
  sunLight.shadow.camera.top = 35;
  sunLight.shadow.camera.bottom = -35;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 90;
  scene.add(sunLight);

  const sunAccent = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xffc857 })
  );
  sunAccent.position.set(-26, 26, -38);
  scene.add(sunAccent);

  const ground = new THREE.Mesh(
    new THREE.CylinderGeometry(40, 44, 2.4, 48),
    new THREE.MeshStandardMaterial({ color: palette.grass, roughness: 1 })
  );
  ground.receiveShadow = true;
  ground.position.y = -1.2;
  worldRoot.add(ground);
}

function addRigidMesh(mesh, bodyDesc, colliderDesc) {
  worldRoot.add(mesh);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const rigidBody = rapierWorld.createRigidBody(bodyDesc);
  rapierWorld.createCollider(colliderDesc, rigidBody);
  return { mesh, rigidBody };
}

function buildPhysicsWorld() {
  rapierWorld = new RAPIER.World({ x: 0, y: -12, z: 0 });
  pushableBodies = [];
  dynamicSceneBodies = [];

  const groundBody = rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed());
  rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(44, 0.6, 44).setTranslation(0, -0.6, 0), groundBody);

  const dynamicObjects = [
    {
      kind: "box",
      color: 0x4ecdc4,
      position: [-7, 1.1, -4],
      size: [1.2, 1.2, 1.2],
    },
    {
      kind: "box",
      color: 0xf25f5c,
      position: [7, 1.4, -6],
      size: [1.4, 1.4, 1.4],
    },
    {
      kind: "box",
      color: 0xffd166,
      position: [0, 0.9, 7],
      size: [1, 1, 1],
    },
    {
      kind: "cylinder",
      color: 0x7b2cbf,
      position: [-2.5, 1.1, 2.5],
      radius: 0.85,
      height: 1.8,
    },
    {
      kind: "cylinder",
      color: 0x1a759f,
      position: [5.5, 1.3, 3],
      radius: 0.7,
      height: 2.2,
    },
    {
      kind: "sphere",
      color: 0xf7b267,
      position: [-5.5, 1.05, 6.5],
      radius: 1.05,
    },
    {
      kind: "sphere",
      color: 0x90be6d,
      position: [3.5, 0.95, -1.5],
      radius: 0.95,
    },
  ];

  dynamicObjects.forEach((spec) => {
    let mesh;
    let colliderDesc;

    if (spec.kind === "box") {
      const [width, height, depth] = spec.size;
      mesh = new THREE.Mesh(
        new THREE.BoxGeometry(width * 2, height * 2, depth * 2),
        new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.96 })
      );
      colliderDesc = RAPIER.ColliderDesc.cuboid(width, height, depth).setRestitution(0.12);
    } else if (spec.kind === "cylinder") {
      mesh = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.radius, spec.radius, spec.height, 18),
        new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.94 })
      );
      colliderDesc = RAPIER.ColliderDesc.cylinder(spec.height / 2, spec.radius).setRestitution(0.08);
    } else {
      mesh = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius, 20, 20),
        new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.9 })
      );
      colliderDesc = RAPIER.ColliderDesc.ball(spec.radius).setRestitution(0.36);
    }

    mesh.position.set(...spec.position);
    const bodyEntry = addRigidMesh(
      mesh,
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spec.position[0], spec.position[1], spec.position[2])
        .setLinearDamping(0.12)
        .setAngularDamping(0.22)
        .setCcdEnabled(true),
      colliderDesc.setMass(0.28)
    );
    pushableBodies.push(bodyEntry);
    dynamicSceneBodies.push(bodyEntry);
  });

  const vehicleGroup = new THREE.Group();

  const body = createRoundedBox(1.9, 0.7, 3.2, 0.25, 0xf25f5c);
  body.position.y = 0.9;
  vehicleGroup.add(body);

  const cabin = createRoundedBox(1.35, 0.55, 1.4, 0.22, 0xfff7eb);
  cabin.position.set(0, 1.37, -0.15);
  vehicleGroup.add(cabin);

  const windshield = new THREE.Mesh(
    new THREE.BoxGeometry(1.1, 0.42, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x9bf6ff, transparent: true, opacity: 0.82 })
  );
  windshield.position.set(0, 1.38, 0.42);
  vehicleGroup.add(windshield);

  const wheelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 0.38, 16);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheelMaterial = new THREE.MeshStandardMaterial({ color: 0x20253f, roughness: 1 });
  const wheelOffsets = [
    [-0.92, 0.42, 1.15],
    [0.92, 0.42, 1.15],
    [-0.92, 0.42, -1.15],
    [0.92, 0.42, -1.15],
  ];

  frontWheelPivots = [];
  wheelMeshes = wheelOffsets.map(([x, y, z], index) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    vehicleGroup.add(pivot);

    const wheel = new THREE.Mesh(wheelGeometry, wheelMaterial);
    wheel.castShadow = true;
    pivot.add(wheel);

    if (index < 2) {
      frontWheelPivots.push(pivot);
    }

    return wheel;
  });

  const spoiler = new THREE.Mesh(
    new THREE.BoxGeometry(1.4, 0.1, 0.42),
    new THREE.MeshStandardMaterial({ color: 0x2f365f, roughness: 0.85 })
  );
  spoiler.position.set(0, 1.24, -1.62);
  vehicleGroup.add(spoiler);

  vehicleMesh = vehicleGroup;
  vehicleMesh.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  worldRoot.add(vehicleMesh);

  vehicleBody = rapierWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(resetPosition.x, resetPosition.y, resetPosition.z)
      .setLinearDamping(0.08)
      .setAngularDamping(1.05)
      .enabledRotations(false, true, false)
      .setCcdEnabled(true)
      .setCanSleep(false)
  );
  rapierWorld.createCollider(
    RAPIER.ColliderDesc.cuboid(1.1, 0.45, 1.65)
      .setMass(4.5)
      .setRestitution(0.02)
      .setFriction(0.35),
    vehicleBody
  );
}

function syncDynamicSceneBodies() {
  dynamicSceneBodies.forEach(({ mesh, rigidBody }) => {
    const translation = rigidBody.translation();
    const rotation = rigidBody.rotation();
    mesh.position.set(translation.x, translation.y, translation.z);
    mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  });
}

function resetVehicle() {
  vehicleBody.setTranslation(resetPosition, true);
  vehicleBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
  vehicleBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
  vehicleBody.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
  steeringAngle = 0;
  driveSpeed = 0;
}

function updateVehicle(delta) {
  const bodyPosition = vehicleBody.translation();
  const bodyRotation = vehicleBody.rotation();
  vehicleMesh.position.set(bodyPosition.x, bodyPosition.y, bodyPosition.z);
  vehicleMesh.quaternion.set(bodyRotation.x, bodyRotation.y, bodyRotation.z, bodyRotation.w);

  vehicleForward.set(0, 0, 1).applyQuaternion(vehicleMesh.quaternion);
  vehicleForward.y = 0;
  vehicleForward.normalize();

  const velocity = vehicleBody.linvel();
  const planarSpeed = Math.hypot(velocity.x, velocity.z);
  speedReadout.textContent = `Speed ${Math.round(planarSpeed * 18)} km/h`;
  speedMeterFill.style.width = `${THREE.MathUtils.clamp(planarSpeed * 12, 4, 100)}%`;

  const accelerating = keys.has("KeyW") || keys.has("ArrowUp");
  const reverseKey = keys.has("KeyS") || keys.has("ArrowDown");
  const turningLeft = keys.has("KeyA") || keys.has("ArrowLeft");
  const turningRight = keys.has("KeyD") || keys.has("ArrowRight");

  const forwardSpeed = velocity.x * vehicleForward.x + velocity.z * vehicleForward.z;
  const throttleInput = accelerating ? 1 : 0;
  const reverseInput = reverseKey ? 1 : 0;
  const steerInput = (turningLeft ? 1 : 0) - (turningRight ? 1 : 0);
  const steerBlend = steerInput === 0 ? vehicleTuning.steerReturn : vehicleTuning.steerResponse;
  steeringAngle = THREE.MathUtils.lerp(
    steeringAngle,
    steerInput * vehicleTuning.maxSteerAngle,
    steerBlend
  );

  // Blend a little toward the actual physics speed so collisions still influence handling.
  driveSpeed = THREE.MathUtils.lerp(driveSpeed, forwardSpeed, 0.08);

  if (throttleInput > 0 && reverseInput === 0) {
    driveSpeed += vehicleTuning.forwardAcceleration * delta;
  } else if (reverseInput > 0 && throttleInput === 0) {
    driveSpeed -= vehicleTuning.reverseAcceleration * delta;
  } else {
    driveSpeed *= vehicleTuning.idleDrag;
  }

  driveSpeed = THREE.MathUtils.clamp(
    driveSpeed,
    -vehicleTuning.maxReverseSpeed,
    vehicleTuning.maxForwardSpeed
  );
  if (Math.abs(driveSpeed) < 0.02) {
    driveSpeed = 0;
  }

  const steeringActive = Math.abs(steeringAngle) > 0.01;
  const signedSpeed = driveSpeed;
  const yawScale = signedSpeed >= 0 ? 1 : vehicleTuning.reverseYawScale;
  const steerTan = Math.tan(steeringAngle);
  const desiredYawVelocity =
    steeringActive && Math.abs(signedSpeed) > 0.02
      ? THREE.MathUtils.clamp(
          (signedSpeed / vehicleTuning.wheelBase) * steerTan * yawScale,
          -vehicleTuning.maxYawRate,
          vehicleTuning.maxYawRate
        )
      : 0;
  const angularVelocity = vehicleBody.angvel();
  vehicleBody.setAngvel(
    {
      x: 0,
      y: THREE.MathUtils.lerp(angularVelocity.y, desiredYawVelocity, 0.32),
      z: 0,
    },
    true
  );

  lateralAxis.set(vehicleForward.z, 0, -vehicleForward.x);
  const lateralSpeed = velocity.x * lateralAxis.x + velocity.z * lateralAxis.z;
  const grip =
    accelerating || reverseInput > 0 ? vehicleTuning.lateralGrip : vehicleTuning.coastGrip;
  const retainedLateralSpeed = lateralSpeed * (1 - grip);
  vehicleBody.setLinvel(
    {
      x: vehicleForward.x * driveSpeed + lateralAxis.x * retainedLateralSpeed,
      y: velocity.y,
      z: vehicleForward.z * driveSpeed + lateralAxis.z * retainedLateralSpeed,
    },
    true
  );

  const clampedPosition = vehicleBody.translation();
  const boundary = 39.5;
  if (Math.abs(clampedPosition.x) > boundary || Math.abs(clampedPosition.z) > boundary) {
    vehicleBody.setTranslation(
      {
        x: THREE.MathUtils.clamp(clampedPosition.x, -boundary, boundary),
        y: Math.max(clampedPosition.y, 0.6),
        z: THREE.MathUtils.clamp(clampedPosition.z, -boundary, boundary),
      },
      true
    );
    vehicleBody.setLinvel({ x: velocity.x * 0.6, y: 0, z: velocity.z * 0.6 }, true);
  }

  const tilt = THREE.MathUtils.clamp(vehicleBody.rotation().z * 3.4, -0.18, 0.18);
  wheelMeshes.forEach((wheel, index) => {
    const rollingDirection = driveSpeed >= 0 ? -1 : 1;
    wheel.rotation.x += rollingDirection * Math.abs(driveSpeed) * delta * 7 * (index < 2 ? 1 : 0.96);
  });
  frontWheelPivots.forEach((pivot) => {
    pivot.rotation.y = steeringAngle;
  });

  if (bodyPosition.y < -6) {
    resetVehicle();
  }

  hintReadout.textContent =
    planarSpeed > 2.8 ? "有速度了，直接去撞幾何物件看看回饋。" : "先對準前面的幾何方塊，感受碰撞手感。";

  vehicleMesh.children[0].rotation.y = tilt;

  applyPushToDynamicBodies(planarSpeed);
}

function applyPushToDynamicBodies(planarSpeed) {
  if (planarSpeed < 0.9) {
    return;
  }

  const vehiclePos = vehicleBody.translation();
  const vehicleVel = vehicleBody.linvel();
  const forwardSpeed = Math.hypot(vehicleVel.x, vehicleVel.z);

  pushableBodies.forEach(({ rigidBody }) => {
    const objectPos = rigidBody.translation();
    const dx = objectPos.x - vehiclePos.x;
    const dz = objectPos.z - vehiclePos.z;
    const distance = Math.hypot(dx, dz);

    if (distance > 2.35 || distance < 0.001) {
      return;
    }

    const directionX = dx / distance;
    const directionZ = dz / distance;
    const forwardDot = directionX * vehicleForward.x + directionZ * vehicleForward.z;

    if (forwardDot < 0.35) {
      return;
    }

    const impulseStrength = THREE.MathUtils.clamp(forwardSpeed * 0.22, 0.18, 1.35);
    rigidBody.applyImpulse(
      {
        x: directionX * impulseStrength,
        y: 0.04,
        z: directionZ * impulseStrength,
      },
      true
    );
  });
}

function updateCamera() {
  vehiclePosition.copy(vehicleMesh.position);

  chaseOffset.set(
    Math.sin(pointer.yaw) * Math.cos(pointer.pitch),
    Math.sin(pointer.pitch) * 0.9 + 0.45,
    Math.cos(pointer.yaw) * Math.cos(pointer.pitch)
  );
  chaseOffset.multiplyScalar(10);

  cameraTarget.copy(vehiclePosition).add(new THREE.Vector3(0, 1.4, 0));
  cameraPosition.copy(vehiclePosition).add(chaseOffset);

  camera.position.lerp(cameraPosition, 0.08);
  camera.lookAt(cameraTarget);
}

function bindEvents() {
  window.addEventListener("keydown", (event) => {
    keys.add(event.code);
    if (event.code === "KeyR") {
      resetVehicle();
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  renderer.domElement.addEventListener("pointerdown", (event) => {
    pointer.active = true;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    renderer.domElement.setPointerCapture(event.pointerId);
  });

  renderer.domElement.addEventListener("pointermove", (event) => {
    if (!pointer.active) {
      return;
    }
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    pointer.startX = event.clientX;
    pointer.startY = event.clientY;
    pointer.yaw -= deltaX * 0.0052;
    pointer.pitch = THREE.MathUtils.clamp(pointer.pitch - deltaY * 0.004, 0.08, 0.72);
  });

  renderer.domElement.addEventListener("pointerup", (event) => {
    pointer.active = false;
    renderer.domElement.releasePointerCapture(event.pointerId);
  });

  window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

async function init() {
  await RAPIER.init();
  buildWorldDecor();
  buildPhysicsWorld();
  bindEvents();

  objectivesCard.innerHTML = `
    <p class="hud__section-title">Things To Try</p>
    <p>撞開前方方塊</p>
    <p>把球推到遠處</p>
    <p>測試不同角度的碰撞反應</p>
  `;

  loadingLabel.classList.add("loading--hidden");
  startButton.classList.add("start-button--visible");
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 1 / 30);

  if (rapierWorld && vehicleBody) {
    rapierWorld.step();
    syncDynamicSceneBodies();
    updateVehicle(delta);
    updateCamera();
  }

  renderer.render(scene, camera);
}

startButton.addEventListener("click", () => {
  startButton.classList.add("start-button--hidden");
  clock.start();
});

init();
animate();
