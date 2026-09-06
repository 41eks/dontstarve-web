import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import pigKingUrl from './assets/384px-Pig_King.png';

const pigKingTexture = new THREE.TextureLoader().load(pigKingUrl);
pigKingTexture.colorSpace = THREE.SRGBColorSpace;

const pigKingScale = 2;
const pigKingHeight = 12;
const pigKingWidth = pigKingHeight * (384 / 344);
const pigKingDepth = 1;
const pigKingGeometry = new THREE.PlaneGeometry(pigKingWidth, pigKingHeight);
const pigKingMaterial = new THREE.MeshBasicMaterial({
    map: pigKingTexture,
    transparent: true,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
    toneMapped: false,
});
const pigKingPlane = new THREE.Mesh(pigKingGeometry, pigKingMaterial);
pigKingPlane.position.y = pigKingHeight / 2;

const pigKingStandee = new THREE.Group();
pigKingStandee.name = 'PigKingStandee';
pigKingStandee.position.set(0, 0, 25);
pigKingStandee.scale.set(pigKingScale, pigKingScale, pigKingScale);
pigKingStandee.add(pigKingPlane);

// 在 Pig King 脚下覆盖一块木地板，略高于草地以避免两个平面闪烁。
const pigKingFloorTexture = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}384px-GROUND_WOODFLOOR.png`
);
pigKingFloorTexture.colorSpace = THREE.SRGBColorSpace;
pigKingFloorTexture.wrapS = THREE.RepeatWrapping;
pigKingFloorTexture.wrapT = THREE.RepeatWrapping;
pigKingFloorTexture.repeat.set(0.3, 0.3);

const pigKingFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(36, 36),
    new THREE.MeshLambertMaterial({
        map: pigKingFloorTexture,
        side: THREE.DoubleSide,
    }),
);
pigKingFloor.name = 'PigKingFloor';
pigKingFloor.rotation.x = -Math.PI / 2;
pigKingFloor.position.copy(pigKingStandee.position);
pigKingFloor.position.y = 0.02;
pigKingFloor.receiveShadow = true;

const pigKingBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(
        (pigKingWidth * pigKingScale) / 2,
        (pigKingHeight * pigKingScale) / 2,
        pigKingDepth / 2,
    )),
    position: new CANNON.Vec3(
        pigKingStandee.position.x,
        pigKingStandee.position.y + (pigKingHeight * pigKingScale) / 2,
        pigKingStandee.position.z,
    ),
});

function setPigKingNormal(normal: THREE.Vector3) {
    const horizontalNormal = normal.clone();
    horizontalNormal.y = 0;

    if (horizontalNormal.lengthSq() === 0) {
        return;
    }

    horizontalNormal.normalize();
    pigKingStandee.rotation.y = Math.atan2(horizontalNormal.x, horizontalNormal.z);
    pigKingBody.quaternion.setFromEuler(0, pigKingStandee.rotation.y, 0);
    pigKingBody.aabbNeedsUpdate = true;
}

export { pigKingStandee, pigKingFloor, pigKingBody, setPigKingNormal };
