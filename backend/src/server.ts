import { app } from './app';
import { config, assertProductionConfig } from './config';

assertProductionConfig();

app.listen(config.port, () => {
    console.log(`Field visit API listening on port ${config.port} (${config.nodeEnv})`);
});
