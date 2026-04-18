import express from 'express';
import cors from 'cors';
import { config } from '../config.js';
import { router } from './routes.js';
export function createApp() {
    const app = express();
    app.use(cors({
        origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()),
    }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(router);
    return app;
}
//# sourceMappingURL=app.js.map