import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import {
    createAnimatedSprite,
    type SpriteAnimationController,
} from '@three-roaming/wilson/sprite';

const pigKingHeight = 24;
const pigKingWidth = pigKingHeight * (384 / 344);
const pigKingDepth = 1;

const pigKingStandee = await createAnimatedSprite(
    `${import.meta.env.BASE_URL}dst/data/anim`,
    'pig_king.zip',
    {
        initialAnimation: 'idle',
        name: 'PigKingStandee',
        scale: 0.04,
    },
);
pigKingStandee.position.set(0, 0, 25);
pigKingStandee.updateWorldMatrix(true, true);
const pigKingBounds = new THREE.Box3().setFromObject(pigKingStandee);
pigKingStandee.position.y -= pigKingBounds.min.y;

const pigKingAnimation = pigKingStandee.userData.animationController as SpriteAnimationController;

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
pigKingFloor.position.set(pigKingStandee.position.x, 0.02, pigKingStandee.position.z);
pigKingFloor.receiveShadow = true;

const pigKingBody = new CANNON.Body({
    mass: 0,
    shape: new CANNON.Box(new CANNON.Vec3(
        pigKingWidth / 2,
        pigKingHeight / 2,
        pigKingDepth / 2,
    )),
    position: new CANNON.Vec3(
        pigKingStandee.position.x,
        pigKingHeight / 2,
        pigKingStandee.position.z,
    ),
});

function setupPigKingInteraction(
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;

        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
        raycaster.setFromCamera(pointer, camera);
        pigKingStandee.updateWorldMatrix(true, true);
        if (raycaster.intersectObject(pigKingStandee, true).length === 0) return;

        pigKingAnimation.playOnce('unimpressed', () => {
            pigKingAnimation.start('idle');
        });
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    return () => renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
}

function updatePigKingAnimation(dt: number) {
    pigKingAnimation.update(dt);
}

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

export {
    pigKingStandee,
    pigKingFloor,
    pigKingBody,
    setPigKingNormal,
    setupPigKingInteraction,
    updatePigKingAnimation,
};
