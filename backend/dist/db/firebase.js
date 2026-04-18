import admin from 'firebase-admin';
import { config } from '../config.js';
const serviceAccount = JSON.parse(Buffer.from(config.FIREBASE_CREDENTIALS, 'base64').toString('utf-8'));
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});
export const db = admin.firestore();
//# sourceMappingURL=firebase.js.map