
import type {FieldValue, Timestamp} from 'firebase/firestore';

export type User = {
    uid: string;
    username: string;
    gender: 'male' | 'female';
    matchPreference: 'male' | 'female' | 'both';
    isMicOn: boolean;
    isCamOn: boolean;
    status: 'searching' | 'in-chat' | 'offline' | 'idle';
    createdAt: FieldValue;
    chatId?: string;
};

export type Message = {
    id: string;
    senderId: string;
    text: string | null;
    imageUrl?: string | null;
    timestamp: Timestamp;
};
