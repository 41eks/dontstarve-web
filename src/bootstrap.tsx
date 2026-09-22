import '@fontsource/noto-sans-sc/chinese-simplified-700.css';
import '@fontsource/noto-sans-sc/chinese-simplified-900.css';
import { createRoot } from 'react-dom/client';
import GeneratingWorldPage from './pages/GeneratingWorldPage';
import HamletMainScreenPage from './pages/HamletMainScreenPage';

const GAME_START_DELAY_MS = 5_000;
const app = document.querySelector<HTMLElement>('#app');

if (!app) throw new Error('Missing #app mount point');
const mountPoint = app;

const root = createRoot(mountPoint);
let started = false;

function enterGame(): void {
  if (started) return;
  started = true;
  let timerStarted = false;
  const startGameTimer = (): void => {
    if (timerStarted) return;
    timerStarted = true;
    window.setTimeout(() => {
      root.unmount();
      mountPoint.replaceChildren();
      document.title = '2dot5d';
      void import('./main.ts').catch((error: unknown) => {
        console.error('Unable to start the game', error);
        mountPoint.textContent = '游戏载入失败，请刷新页面后重试。';
      });
    }, GAME_START_DELAY_MS);
  };
  root.render(<GeneratingWorldPage onReady={startGameTimer} />);
}

root.render(<HamletMainScreenPage onStart={enterGame} />);
