import * as THREE from 'three';

const MESSAGE_DURATION = 2000;

export function setupPigInteraction(
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    pig: THREE.Object3D,
    player: THREE.Object3D,
) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const playerBounds = new THREE.Box3();
    const headPosition = new THREE.Vector3();
    const message = document.createElement('div');
    let hideTimer: number | undefined;

    message.id = 'pig-message';
    message.textContent = '时间会证明猪模块';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    document.body.appendChild(message);

    function updateMessagePosition() {
        if (!message.classList.contains('is-visible')) {
            return;
        }

        player.updateWorldMatrix(true, true);
        playerBounds.setFromObject(player);
        playerBounds.getCenter(headPosition);
        headPosition.y = playerBounds.max.y + 1;
        camera.updateMatrixWorld();
        headPosition.project(camera);

        const isOnScreen =
            headPosition.z >= -1 && headPosition.z <= 1 &&
            Math.abs(headPosition.x) <= 1 &&
            Math.abs(headPosition.y) <= 1;
        message.style.visibility = isOnScreen ? 'visible' : 'hidden';

        if (!isOnScreen) {
            return;
        }

        const bounds = renderer.domElement.getBoundingClientRect();
        message.style.left = `${bounds.left + (headPosition.x + 1) * bounds.width / 2}px`;
        message.style.top = `${bounds.top + (1 - headPosition.y) * bounds.height / 2}px`;
    }

    renderer.domElement.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }

        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        pig.updateWorldMatrix(true, true);
        if (raycaster.intersectObject(pig, true).length === 0) {
            return;
        }

        message.classList.add('is-visible');
        updateMessagePosition();
        if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
        }
        hideTimer = window.setTimeout(() => {
            message.classList.remove('is-visible');
            hideTimer = undefined;
        }, MESSAGE_DURATION);
    });

    return updateMessagePosition;
}
