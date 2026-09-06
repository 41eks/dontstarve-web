import * as THREE from 'three';

const MESSAGE_DURATION = 2000;

export function setupPigInteraction(
    camera: THREE.Camera,
    renderer: THREE.WebGLRenderer,
    pig: THREE.Object3D,
) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const message = document.createElement('div');
    let hideTimer: number | undefined;

    message.id = 'pig-message';
    message.textContent = '时间会证明猪模块';
    message.setAttribute('role', 'status');
    message.setAttribute('aria-live', 'polite');
    document.body.appendChild(message);

    renderer.domElement.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) {
            return;
        }

        const bounds = renderer.domElement.getBoundingClientRect();
        pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
        pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;

        raycaster.setFromCamera(pointer, camera);
        if (raycaster.intersectObject(pig, true).length === 0) {
            return;
        }

        message.classList.add('is-visible');
        if (hideTimer !== undefined) {
            window.clearTimeout(hideTimer);
        }
        hideTimer = window.setTimeout(() => {
            message.classList.remove('is-visible');
            hideTimer = undefined;
        }, MESSAGE_DURATION);
    });
}
