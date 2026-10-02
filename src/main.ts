import './ui/styles.css';
import { Game } from './core/Game';
import { parseSeed } from './core/rng';

const canvas = document.getElementById('app') as HTMLCanvasElement;
const game = new Game(canvas);

// expose for debugging from the console
(window as unknown as { game: Game }).game = game;

// ?autostart skips the title screen (useful for demos and automated smoke tests)
const params = new URLSearchParams(location.search);
if (params.has('autostart')) void game.startWorld(parseSeed(params.get('seed') ?? '1337'));
