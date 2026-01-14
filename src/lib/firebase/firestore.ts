import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
  addDoc,
  onSnapshot,
  deleteDoc,
  writeBatch,
  Timestamp,
  orderBy,
  limit,
} from 'firebase/firestore';
import {firestore} from './config';
import type {User, UserPreferences, Message} from '@/lib/types';

// User Management
export const createUser = async (
  uid: string,
  username: string,
  preferences: UserPreferences
) => {
  const userRef = doc(firestore, 'users', uid);
  const newUser: User = {
    uid,
    username,
    preferences,
    status: 'online',
    createdAt: serverTimestamp(),
  };
  await setDoc(userRef, newUser, { merge: true });
  // Also create a document in active_users to show presence
  await setDoc(doc(firestore, 'active_users', uid), { uid, lastSeen: serverTimestamp() });
  return newUser;
};

export const getUser = async (uid: string): Promise<User | null> => {
  const userRef = doc(firestore, 'users', uid);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() ? (userSnap.data() as User) : null;
};

export const updateUserStatus = async (uid: string, status: User['status']) => {
  if (!uid) return;
  const userRef = doc(firestore, 'users', uid);
  const activeUserRef = doc(firestore, 'active_users', uid);
  try {
    if (status === 'offline') {
      await deleteDoc(activeUserRef);
    } else {
      await setDoc(activeUserRef, { uid, lastSeen: serverTimestamp() }, { merge: true });
    }
    await updateDoc(userRef, {status});
  } catch(e) {
    //   User might not exist, which is fine
    console.log("Could not update user status, maybe they don't exist yet", e);
  }
};

export const findPartner = async (
  uid: string,
  preferences: UserPreferences
) => {
  // Build query based on preferences
  const queueRef = collection(firestore, 'queue');
  let q;

  if (preferences.matchPreference === 'both') {
      q = query(
          queueRef,
          where('uid', '!=', uid),
          orderBy('timestamp', 'asc'),
          limit(1)
      );
  } else {
      q = query(
          queueRef,
          where('uid', '!=', uid),
          where('preferences.gender', '==', preferences.matchPreference),
          orderBy('uid'), // required for inequality
          orderBy('timestamp', 'asc'),
          limit(1)
      );
  }

  const querySnapshot = await getDocs(q);

  if (querySnapshot.empty) {
    // No one in queue that matches, so add current user to queue
    await setDoc(doc(firestore, 'queue', uid), {
      uid,
      preferences,
      timestamp: serverTimestamp(),
    });
    return null;
  } else {
    // Match found!
    const partnerDoc = querySnapshot.docs[0];
    const partnerUid = partnerDoc.data().uid;

    // Create a new chat session
    const chatRef = doc(collection(firestore, 'chats'));
    const chatId = chatRef.id;

    const chatData = {
      id: chatId,
      participants: [uid, partnerUid],
      createdAt: serverTimestamp(),
    };

    await setDoc(chatRef, chatData);

    // Remove both users from the queue in a batch
    const batch = writeBatch(firestore);
    batch.delete(doc(firestore, 'queue', uid));
    batch.delete(doc(firestore, 'queue', partnerUid));
    await batch.commit();
    
    // Update user statuses
    await updateUserStatus(uid, 'in-chat');
    await updateUserStatus(partnerUid, 'in-chat');

    return {chatId, partnerUid};
  }
};

export const listenForPartner = (uid: string, callback: (chatId: string | null, partnerUid: string | null) => void) => {
    // This function will now be primarily used by the queue page.
    // It checks if a chat has been created for the user.
    const q = query(collection(firestore, 'chats'), where('participants', 'array-contains', uid));

    const unsubscribe = onSnapshot(q, async (snapshot) => {
        if (!snapshot.empty) {
            const chatDoc = snapshot.docs[0]; // Assuming user is only in one chat
            const participants = chatDoc.data().participants as string[];
            const partnerUid = participants.find(p => p !== uid);
            
            if (partnerUid) {
                // If we found a partner, we can stop listening.
                unsubscribe();

                // Make sure user is removed from queue
                const userInQueueRef = doc(firestore, 'queue', uid);
                await deleteDoc(userInQueueRef).catch(() => {});

                callback(chatDoc.id, partnerUid);
            }
        }
    });
    return unsubscribe;
};

export const getChatDoc = async (chatId: string) => {
    const chatRef = doc(firestore, 'chats', chatId);
    const chatSnap = await getDoc(chatRef);
    return chatSnap.exists() ? chatSnap.data() : null;
};

// WebRTC Signaling
export const createOffer = async (
  chatId: string,
  uid: string,
  offer: RTCSessionDescriptionInit
) => {
  const offerRef = doc(firestore, 'chats', chatId, 'peers', uid);
  await setDoc(offerRef, {offer}, { merge: true });
};

export const listenForOffer = (
  chatId: string,
  partnerUid: string,
  callback: (offer: RTCSessionDescriptionInit) => void
) => {
  if (!partnerUid) return () => {};
  const offerRef = doc(firestore, 'chats', chatId, 'peers', partnerUid);
  return onSnapshot(offerRef, (doc) => {
    if (doc.exists() && doc.data().offer) {
      callback(doc.data().offer);
    }
  });
};

export const createAnswer = async (
  chatId: string,
  uid: string,
  answer: RTCSessionDescriptionInit
) => {
  const peerRef = doc(firestore, 'chats', chatId, 'peers', uid);
  await updateDoc(peerRef, {answer});
};

export const listenForAnswer = (
  chatId: string,
  partnerUid: string,
  callback: (answer: RTCSessionDescriptionInit) => void
) => {
    if (!partnerUid) return () => {};
  const peerRef = doc(firestore, 'chats', chatId, 'peers', partnerUid);
  return onSnapshot(peerRef, (doc) => {
    if (doc.exists() && doc.data().answer) {
      callback(doc.data().answer);
    }
  });
};

export const addIceCandidate = async (
  chatId: string,
  uid: string,
  candidate: RTCIceCandidateInit
) => {
  const candidatesCol = collection(
    firestore,
    'chats',
    chatId,
    'peers',
    uid,
    'iceCandidates'
  );
  await addDoc(candidatesCol, candidate);
};

export const listenForIceCandidates = (
  chatId: string,
  partnerUid: string,
  callback: (candidate: RTCIceCandidateInit) => void
) => {
  if (!partnerUid) return () => {};
  const candidatesCol = collection(
    firestore,
    'chats',
    chatId,
    'peers',
    partnerUid,
    'iceCandidates'
  );
  return onSnapshot(candidatesCol, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        callback(change.doc.data());
      }
    });
  });
};

// Chat Messages
export const sendMessage = async (chatId: string, senderId: string, text: string, imageUrl?: string) => {
    const messagesCol = collection(firestore, 'chats', chatId, 'messages');
    await addDoc(messagesCol, {
        senderId,
        text: text || null,
        imageUrl: imageUrl || null,
        timestamp: serverTimestamp()
    });
};

export const listenForMessages = (chatId: string, callback: (messages: Message[]) => void) => {
    const messagesCol = collection(firestore, 'chats', chatId, 'messages');
    const q = query(messagesCol, orderBy('timestamp', 'asc'));
    return onSnapshot(q, (snapshot) => {
        const messages = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()} as Message));
        callback(messages);
    })
};

export const endChat = async (chatId: string, myUid: string) => {
    try {
        const chatRef = doc(firestore, 'chats', chatId);
        const chatSnap = await getDoc(chatRef);
        
        if (chatSnap.exists()) {
            const partnerUid = (chatSnap.data().participants as string[]).find(p => p !== myUid);
            if (partnerUid) {
                await updateUserStatus(partnerUid, 'online');
            }
             // This is aggressive, but for a random chat app, it's ok.
             // We'll delete the chat document and all subcollections.
            await deleteDoc(chatRef);
        }
    } catch (e) {
        console.error("Error ending chat:", e);
    } finally {
        await updateUserStatus(myUid, 'online');
    }
};
