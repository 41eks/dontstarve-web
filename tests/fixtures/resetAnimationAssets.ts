import { afterEach } from 'vitest';
import { disposeAnimationAssets } from '../../packages/animation/src/animationAssets';

// Asset caches are global in a game session; each test starts a new session.
afterEach(() => disposeAnimationAssets());
