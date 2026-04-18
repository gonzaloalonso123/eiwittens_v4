import { createApp } from './server/app.js';
import { config } from './config.js';
const app = createApp();
app.listen(config.PORT, () => {
    console.log(`[server] Listening on port ${config.PORT}`);
});
//# sourceMappingURL=main.js.map