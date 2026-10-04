import { afterEach } from 'vitest';
import { disposeAnimationAssets } from '../src/animationAssets';

// Asset caches are global in a game session; each test starts a new session.
afterEach(() => disposeAnimationAssets());
