let body = $response.body;

// Nếu là JSON thì parse thử
try { body = JSON.parse($response.body); } catch (e) {}
const CONFIG = {
  SCREEN: {
    CENTER_X: 1376,
    CENTER_Y: 1032,
    FOV_RADIUS: 180,
    DEPTH_SCALE: 1000 // Scale for Z-axis conversion
  },
  FIRE_BUTTON: {
    x: 1000,
    y: 1800
  },
  BONE_NECK: {
    position: {
      x: -0.128512,
      y: 0.0,
      z: 0.0
    },
    rotation: {
      x: -0.012738,
      y: -0.002122,
      z: 0.164307,
      w: 0.986325
    },
    scale: {
      x: 1.0,
      y: 1.0,
      z: 1.0
    },
    hitbox1: {
      radius: 0.0702899992,
      height: 0.170000002,
      offset: {
        x: -0.0799999982,
        y: -0.00999999978,
        z: 0.0018120259
      }
    },
    hitbox2: {
      radius: 0.0900000036,
      height: 0.189999998,
      offset: {
        x: -0.0110000093,
        y: 0.0170598757,
        z: -0.00047457777
      }
    }
  },
  AIM_ZONES: {
    neck: { radius: 15, priority: 10, bone: true },
    head: { radius: 22, priority: 8, bone: true },
    chest: { radius: 35, priority: 3, bone: false }
  },
  NECK_3D_LOCK: {
    enabled: true,
    lockRadius: 9999.0,
    lockForce: 9999.0,
    magnetism: 9999.0,
    boneTracking: true,
    quaternionCorrection: true,
    depthCompensation: true
  },
  DRAG_HEADSHOT: {
    enabled: true,
    dragThreshold: 12,
    dragForce: 9999.0,
    transitionSmooth: 0.85,
    headSnapRadius: 13,
    neckToHeadTransition: true,
    dragHistory: 3
  },
  SENSITIVITY: {
    dpi: 10000,
    gameSensitivity: 99999
  },
  MODES: {
    manualOverride: false,
    debugOverlay: true,
    bone3D: true,
    dragMode: true
  }
};

let CENTER_X = CONFIG.SCREEN.CENTER_X;
let CENTER_Y = CONFIG.SCREEN.CENTER_Y;

// 3D Math utilities for bone tracking
class Vector3D {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  add(v) {
    return new Vector3D(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  multiply(scalar) {
    return new Vector3D(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  distance(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  normalize() {
    const len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    if (len === 0) return new Vector3D(0, 0, 0);
    return new Vector3D(this.x / len, this.y / len, this.z / len);
  }

  // Convert 3D to 2D screen coordinates
  toScreen(camera) {
    const depth = this.z + 1e-3; // Avoid division by zero
    const screenX = CENTER_X + (this.x * CONFIG.SCREEN.DEPTH_SCALE / depth);
    const screenY = CENTER_Y + (this.y * CONFIG.SCREEN.DEPTH_SCALE / depth);
    return { x: screenX, y: screenY };
  }
}

class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  // Apply quaternion rotation to vector
  rotateVector(v) {
    const qx = this.x, qy = this.y, qz = this.z, qw = this.w;
    const vx = v.x, vy = v.y, vz = v.z;

    const uvx = qy * vz - qz * vy;
    const uvy = qz * vx - qx * vz;
    const uvz = qx * vy - qy * vx;

    const uuvx = qy * uvz - qz * uvy;
    const uuvy = qz * uvx - qx * uvz;
    const uuvz = qx * uvy - qy * uvx;

    return new Vector3D(
      vx + ((uvx * qw) + uuvx) * 2,
      vy + ((uvy * qw) + uuvy) * 2,
      vz + ((uvz * qw) + uuvz) * 2
    );
  }

  // Get forward vector from quaternion
  getForwardVector() {
    return this.rotateVector(new Vector3D(0, 0, 1));
  }
}

class BoneNeckTracker {
  constructor() {
    this.vectorHistory = [];
    this.dragHistory = [];
    this.neckBoneHistory = [];
    this.lastFrameTime = Date.now();
    this.isNeckLocked = false;
    this.isDragMode = false;
    this.lockConfidence = 0;
    this.dragTransition = 0;
    this.bone3DPosition = new Vector3D();
    this.boneRotation = new Quaternion();
  }

  // Tính toán vị trí xương cổ 3D với offset từ hitbox
  calculate3DNeckPosition(basePosition, hitboxIndex = 0) {
    const boneData = CONFIG.BONE_NECK;
    const hitbox = hitboxIndex === 0 ? boneData.hitbox1 : boneData.hitbox2;

    const bonePos = new Vector3D(
      boneData.position.x,
      boneData.position.y,
      boneData.position.z
    );

    const hitboxOffset = new Vector3D(
      hitbox.offset.x,
      hitbox.offset.y,
      hitbox.offset.z
    );

    this.boneRotation = new Quaternion(
      boneData.rotation.x,
      boneData.rotation.y,
      boneData.rotation.z,
      boneData.rotation.w
    );

    const rotatedOffset = this.boneRotation.rotateVector(hitboxOffset);
    const finalPos = bonePos.add(rotatedOffset);

    finalPos.x *= boneData.scale.x;
    finalPos.y *= boneData.scale.y;
    finalPos.z *= boneData.scale.z;

    this.bone3DPosition = finalPos;

    return {
      position3D: finalPos,
      radius: hitbox.radius,
      height: hitbox.height,
      screenPos: finalPos.toScreen({ fov: 90 }),
      quaternion: this.boneRotation
    };
  }

  // Lock cổ bằng screen-space (có quaternion correction)
  apply3DNeckLock(inputVector, neckTarget3D) {
    if (!CONFIG.NECK_3D_LOCK.enabled) return inputVector;

    const screenTarget = neckTarget3D.screenPos;
    const dx = screenTarget.x - inputVector.x;
    const dy = screenTarget.y - inputVector.y;
    const distance2D = Math.sqrt(dx * dx + dy * dy);

    const screenRadius = neckTarget3D.radius * CONFIG.SCREEN.DEPTH_SCALE;

    if (distance2D <= screenRadius) {
      this.isNeckLocked = true;
      this.lockConfidence = Math.min(1.0, this.lockConfidence + 0.15);

      if (CONFIG.NECK_3D_LOCK.quaternionCorrection) {
        const forwardVec = neckTarget3D.quaternion.getForwardVector();
        return {
          x: screenTarget.x + forwardVec.x * 2,
          y: screenTarget.y + forwardVec.y * 2
        };
      }

      return { x: screenTarget.x, y: screenTarget.y };
    }

    // Nếu trong vùng lock nhỏ, áp lực nhẹ hơn
    if (distance2D <= CONFIG.NECK_3D_LOCK.lockRadius) {
      const force = CONFIG.NECK_3D_LOCK.lockForce;
      const magnetism = CONFIG.NECK_3D_LOCK.magnetism;
      return {
        x: inputVector.x + dx * force * magnetism,
        y: inputVector.y + dy * force * magnetism
      };
    }

    this.isNeckLocked = false;
    this.lockConfidence = Math.max(0, this.lockConfidence - 0.05);
    return inputVector;
  }

  // Kéo từ cổ sang đầu (drag headshot)
  applyDragHeadshot(vector, neckTarget3D, headTarget) {
    if (!CONFIG.DRAG_HEADSHOT.enabled) return vector;

    const neckScreen = neckTarget3D.screenPos;
    const dragThreshold = CONFIG.DRAG_HEADSHOT.dragThreshold;

    const neckDx = neckScreen.x - vector.x;
    const neckDy = neckScreen.y - vector.y;
    const neckDistance = Math.sqrt(neckDx * neckDx + neckDy * neckDy);

    const headDx = headTarget.x - vector.x;
    const headDy = headTarget.y - vector.y;
    const headDistance = Math.sqrt(headDx * headDx + headDy * headDy);

    const shouldDrag =
      neckDistance < dragThreshold &&
      headDistance < CONFIG.DRAG_HEADSHOT.headSnapRadius;

    if (shouldDrag) {
      this.isDragMode = true;
      this.dragTransition = Math.min(1.0, this.dragTransition + 0.1);

      const smooth = CONFIG.DRAG_HEADSHOT.transitionSmooth;
      const force = CONFIG.DRAG_HEADSHOT.dragForce;
      const blendFactor = this.dragTransition;

      const targetX =
        neckScreen.x * (1 - blendFactor) + headTarget.x * blendFactor;
      const targetY =
        neckScreen.y * (1 - blendFactor) + headTarget.y * blendFactor;

      const finalDx = targetX - vector.x;
      const finalDy = targetY - vector.y;

      const dragVector = {
        x: vector.x + finalDx * force * smooth,
        y: vector.y + finalDy * force * smooth
      };

      this.dragHistory.push(dragVector);
      if (this.dragHistory.length > CONFIG.DRAG_HEADSHOT.dragHistory) {
        this.dragHistory.shift();
      }

      console.log(
        `🎯 DRAG HEADSHOT ACTIVE - Transition: ${(blendFactor * 100).toFixed(1)}%`
      );
      return dragVector;
    }

    this.isDragMode = false;
    this.dragTransition = Math.max(0, this.dragTransition - 0.08);
    return vector;
  }

  // Dự đoán chuyển động cổ 3D bằng lịch sử
  predict3DNeckMovement(neckTarget3D) {
    this.neckBoneHistory.push(neckTarget3D);
    if (this.neckBoneHistory.length > 4) this.neckBoneHistory.shift();

    if (this.neckBoneHistory.length < 2) return neckTarget3D;

    const current = this.neckBoneHistory[this.neckBoneHistory.length - 1];
    const previous = this.neckBoneHistory[this.neckBoneHistory.length - 2];

    const velocity3D = {
      x: current.position3D.x - previous.position3D.x,
      y: current.position3D.y - previous.position3D.y,
      z: current.position3D.z - previous.position3D.z
    };

    const predictedPos3D = new Vector3D(
      current.position3D.x + velocity3D.x * 2.0,
      current.position3D.y + velocity3D.y * 2.0,
      current.position3D.z + velocity3D.z * 2.0
    );

    return {
      ...current,
      position3D: predictedPos3D,
      screenPos: predictedPos3D.toScreen({ fov: 90 })
    };
  }
}

function process3DBoneFrame(inputVector, headPosition) {
  const tracker = new BoneNeckTracker();

  // Bước 1: Lấy vị trí xương cổ 3D hiện tại
  const neckTarget = tracker.calculate3DNeckPosition(headPosition, 0);

  // Bước 2: Dự đoán vị trí tiếp theo dựa trên chuyển động cổ
  const predictedNeck = tracker.predict3DNeckMovement(neckTarget);

  // Bước 3: Áp dụng lock vào vị trí cổ 3D
  let processedVector = tracker.apply3DNeckLock(inputVector, predictedNeck);

  // Bước 4: Kéo drag từ cổ lên đầu
  processedVector = tracker.applyDragHeadshot(processedVector, predictedNeck, headPosition);

  // Bước 5: Loại bỏ giật camera
  processedVector = removeRecoil(processedVector);

  // Bước 6: Làm mượt đầu vào nếu chưa chắc chắn
  processedVector = smoothVector(inputVector, processedVector, 0.3);

  // Bước 7: Thêm nhiễu subpixel nếu cần
  processedVector = addNoise(processedVector);

  // Bước 8: Tối ưu và làm mịn điểm ảnh phụ
  processedVector = refineSubPixel(processedVector);

  // Bước 9: Tối ưu hiệu suất khung hình
  optimizeFPS();

  return processedVector;
}

// =========================================
// 🧠 Hàm xử lý phụ trợ
// =========================================

function removeRecoil(vector) {
  // Giả lập loại bỏ giật do súng
  const recoil = { x: 1.2, y: 2.4 }; // Giả lập recoil hiện tại
  return {
    x: vector.x - recoil.x * 0.15,
    y: vector.y - recoil.y * 0.15
  };
}

function smoothVector(oldVec, newVec, alpha = 0.2) {
  return {
    x: oldVec.x * (1 - alpha) + newVec.x * alpha,
    y: oldVec.y * (1 - alpha) + newVec.y * alpha
  };
}

function addNoise(vector, intensity = 0.12) {
  const noise = () => (Math.random() - 0.5) * 2 * intensity;
  return {
    x: vector.x + noise(),
    y: vector.y + noise()
  };
}

function refineSubPixel(vector) {
  return {
    x: parseFloat(vector.x.toFixed(3)),
    y: parseFloat(vector.y.toFixed(3))
  };
}

function optimizeFPS() {
  // Giả lập giới hạn tốc độ khung hình
  const targetFPS = CONFIG.SCREEN.fpsLimit || 60;
  const delay = 1000 / targetFPS;
  const now = Date.now();
  const diff = now - (globalThis._lastFrameTime || 0);
  if (diff < delay) {
    const wait = delay - diff;
    const start = Date.now();
    while (Date.now() - start < wait);
  }
  globalThis._lastFrameTime = Date.now();
}

function autoFireDrag(screenVector) {
  // Giả lập thao tác kéo & bắn (ADB hoặc auto click)
  const distance = Math.sqrt(
    Math.pow(screenVector.x - CONFIG.FIRE_BUTTON.x, 2) +
    Math.pow(screenVector.y - CONFIG.FIRE_BUTTON.y, 2)
  );

  if (distance < CONFIG.DRAG_HEADSHOT.headSnapRadius) {
    logDebug("🎯 Auto fire headshot trigger!");
    performClick(screenVector);
  } else {
    logDebug("🌀 No trigger - target outside drag radius");
  }
}

function performClick(point) {
  // Giả lập thao tác chạm vào màn hình tại tọa độ point.x, point.y
  console.log(`🖱️ Tap at: (${point.x.toFixed(1)}, ${point.y.toFixed(1)})`);
}

function logDebug(msg) {
  if (CONFIG.MODES.debugOverlay) {
    console.log(`[DEBUG] ${msg}`);
  }
}

// =========================================
// 🔁 Main Handler for Demo
// =========================================

function mainLoopDemo(frameInputVector, headPositionVector3D) {
  const resultVector = process3DBoneFrame(frameInputVector, headPositionVector3D);
  autoFireDrag(resultVector);
  return resultVector;
}

// =========================================
// ✅ Test: Simulate frame
// =========================================

const inputVec = { x: 532, y: 948 }; // Gần tâm màn hình
const headPos = new Vector3D(-0.045697, -0.004478, -0.020043); // Vị trí đầu enemy 3D

const result = mainLoopDemo(inputVec, headPos);

console.log("🎯 Output drag result:", result);
if (typeof body === "object") {
  $done({ body: JSON.stringify(body) });
} else {
  $done({ body });
}
