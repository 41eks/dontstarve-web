import '@fontsource/noto-sans-sc/chinese-simplified-700.css';
import '@fontsource/noto-sans-sc/chinese-simplified-900.css';
import { createRoot } from 'react-dom/client';
import GeneratingWorldPage from './pages/GeneratingWorldPage';
import HamletMainScreenPage from './pages/HamletMainScreenPage';
import { registerAssetCache } from './registerAssetCache';

registerAssetCache();

const app = document.querySelector<HTMLElement>('#app');

if (!app) throw new Error('Missing #app mount point');
const launchMount = document.createElement('div');
app.append(launchMount);
const root = createRoot(launchMount);
let started = false;

async function loadGame(): Promise<void> {
  try {
    const game = await import('./main.ts');
    await game.gameReady;
    root.unmount();
    launchMount.remove();
    document.title = '2dot5d';
  } catch (error: unknown) {
    console.error('Unable to start the game', error);
    root.render(<GeneratingWorldPage loadError="游戏载入失败，请刷新页面后重试。" />);
  }
}

const enterGame = (): void => {
  if (started) return;
  started = true;
  root.render(<GeneratingWorldPage />);
  void loadGame();
};

if (import.meta.env.DEV) {
  enterGame();
} else {
  root.render(<HamletMainScreenPage onStart={enterGame} />);
}
