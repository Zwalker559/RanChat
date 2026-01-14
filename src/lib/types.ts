import type {FieldValue, Timestamp} from 'firebase/firestore';

export type UserPreferences = {
    gender: 'male' | 'female';
    matchPreference: 'male' | 'female' | 'both';
};

export type User = {
    uid: string;
    username: string;
    preferences: UserPreferences;
    status: 'online' | 'searching' | 'in-chat' | 'offline';
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
