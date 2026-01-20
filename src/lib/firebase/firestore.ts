
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
  runTransaction,
} from 'firebase/firestore';
import {firestore} from './config';
import type {User, Message} from '@/lib/types';

type CreateUserData = Omit<User, 'uid' | 'status' | 'createdAt'>;

// User Management
export const createUser = async (
  uid: string,
  userData: CreateUserData,
) => {
  const userRef = doc(firestore, 'users', uid);
  const newUser: Omit<User, 'uid'> & { createdAt: any } = {
    ...userData,
    status: 'idle', // Initial status when user profile is filled out
    createdAt: serverTimestamp(),
  };
  await setDoc(userRef, newUser, { merge: true });
};

export const isUsernameTaken = async (username: string): Promise<boolean> => {
  const usersRef = collection(firestore, 'users');
  const q = query(usersRef, where("username", "==", username), limit(1));
  const querySnapshot = await getDocs(q);
  return !querySnapshot.empty;
};

export const getUser = async (uid: string): Promise<User | null> => {
  if (!uid) return null;
  const userRef = doc(firestore, 'users', uid);
  const userSnap = await getDoc(userRef);
  return userSnap.exists() ? (userSnap.data() as User) : null;
};

export const deleteUser = async (uid: string) => {
    if (!uid) return;
    try {
      const userRef = doc(firestore, 'users', uid);
      const queueRef = doc(firestore, 'queue', uid);

      const batch = writeBatch(firestore);
      batch.delete(userRef);
      batch.delete(queueRef);
      
      await batch.commit();
    } catch(e) {
      // This can fail if the documents don't exist, which is fine.
    }
};


export const updateUser = async (uid: string, data: Partial<User>) => {
    if (!uid) return;
    const userRef = doc(firestore, 'users', uid);
    try {
        await updateDoc(userRef, data);
    } catch (error) {
        // This can happen if the user doc is deleted by another process
        // between the time this function is called and the update is executed.
        // It's a harmless race condition in the context of this app.
    }
};


export const updateUserStatus = async (uid: string, status: User['status']) => {
  if (!uid) return;

  if (status === 'offline') {
    await deleteUser(uid);
  } else {
    const userRef = doc(firestore, 'users', uid);
    try {
      const userDoc = await getDoc(userRef);
      if (userDoc.exists()) {
        await updateDoc(userRef, { status });
      }
    } catch (e) {
        // Harmless race condition where doc is deleted before update.
    }
  }
};

export const addUserToQueue = async (uid: string, currentUserData: Omit<User, 'uid' | 'createdAt' | 'chatId'>) => {
  const queueData = {
    ...currentUserData,
    uid: uid,
    timestamp: serverTimestamp(),
  };
  await setDoc(doc(firestore, 'queue', uid), queueData);
}

export const findPartner = async (
  uid: string,
  currentUser: User
): Promise<{ chatId: string; partnerUid: string } | null> => {
  // Query for potential partners outside the transaction
  const queueRef = collection(firestore, 'queue');
  const q = query(queueRef, orderBy('timestamp', 'asc'), limit(20));
  const querySnapshot = await getDocs(q);

  const potentialPartners = querySnapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() } as User & { id: string }))
    .filter(user => user.id !== uid);

  if (potentialPartners.length === 0) {
    return null;
  }

  // Prioritize matches based on gender preference
  const preferredMatches = potentialPartners.filter(partner =>
    (currentUser.matchPreference === 'both' || currentUser.matchPreference === partner.gender) &&
    (partner.matchPreference === 'both' || partner.matchPreference === currentUser.gender)
  );

  const otherMatches = potentialPartners.filter(partner => !preferredMatches.some(p => p.id === partner.id));
  const sortedPartners = [...preferredMatches, ...otherMatches];

  // Try to match with each potential partner within a transaction
  for (const partner of sortedPartners) {
    const partnerUid = partner.id;
    try {
      const matchResult = await runTransaction(firestore, async (transaction) => {
        const partnerQueueRef = doc(firestore, 'queue', partnerUid);
        const userQueueRef = doc(firestore, 'queue', uid);

        // Check if both users are still in the queue
        const partnerQueueSnap = await transaction.get(partnerQueueRef);
        const userQueueSnap = await transaction.get(userQueueRef);

        if (!partnerQueueSnap.exists() || !userQueueSnap.exists()) {
          // One of the users is no longer in the queue, so this match is void.
          // Returning null from the transaction function will abort it.
          return null;
        }

        // Both users are in the queue, proceed with the match.
        const chatId = doc(collection(firestore, 'chats')).id;
        const chatRef = doc(firestore, 'chats', chatId);

        const chatData = {
          id: chatId,
          participants: [uid, partnerUid],
          createdAt: serverTimestamp(),
        };

        const userRef = doc(firestore, 'users', uid);
        const partnerUserRef = doc(firestore, 'users', partnerUid);

        // Perform all writes atomically
        transaction.set(chatRef, chatData);
        transaction.delete(userQueueRef);
        transaction.delete(partnerQueueRef);
        transaction.update(userRef, { status: 'in-chat' });
        transaction.update(partnerUserRef, { status: 'in-chat' });

        return { chatId, partnerUid };
      });

      // If matchResult is not null, the transaction was successful and we have a match.
      if (matchResult) {
        console.log(`Match found via transaction! Chat: ${matchResult.chatId} between ${uid} and ${partnerUid}`);
        return matchResult;
      }
    } catch (error) {
      // The transaction failed, likely due to contention (another user matched first).
      // This is expected behavior. We log it and let the loop try the next partner.
      console.log(`Matchmaking transaction failed for partner ${partnerUid}. This is likely a normal race condition.`, error);
    }
  }

  // No match was made after trying all potential partners.
  return null;
};


export const listenForPartner = (uid: string, callback: (chatId: string | null, partnerUid: string | null) => void) => {
    const q = query(
        collection(firestore, 'chats'), 
        where('participants', 'array-contains', uid),
        orderBy('createdAt', 'desc'),
        limit(1)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
        const change = snapshot.docChanges().find(change => change.type === 'added');
        if (!change) {
            return;
        }

        const chatDoc = change.doc;
        const chatData = chatDoc.data();
        const participants = chatData.participants as string[];
        const partnerUid = participants.find(p => p !== uid);
        
        if (partnerUid) {
            console.log(`Match received by listener for user ${uid}. Partner: ${partnerUid}, Chat: ${chatDoc.id}`);
            callback(chatDoc.id, partnerUid);
        }
    }, (error) => {
        console.error("Error listening for partner:", error);
        callback(null, null);
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
  await updateDoc(peerRef, { answer });
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

export const endChat = async (chatId: string) => {
    if (!chatId) return;
    try {
        const chatRef = doc(firestore, 'chats', chatId);
        const chatSnap = await getDoc(chatRef);
        
        if (chatSnap.exists()) {
             const batch = writeBatch(firestore);

            // Delete ICE candidates subcollection for each peer
            const peersRef = collection(firestore, 'chats', chatId, 'peers');
            const peersSnap = await getDocs(peersRef);
            for (const peerDoc of peersSnap.docs) {
                const iceCandidatesRef = collection(peerDoc.ref, 'iceCandidates');
                const iceCandidatesSnap = await getDocs(iceCandidatesRef);
                iceCandidatesSnap.forEach(iceDoc => batch.delete(iceDoc.ref));
                batch.delete(peerDoc.ref);
            }

            // Delete messages subcollection
            const messagesRef = collection(firestore, 'chats', chatId, 'messages');
            const messagesSnap = await getDocs(messagesRef);
            messagesSnap.forEach(msgDoc => batch.delete(msgDoc.ref));
            
            // Delete the main chat document
            batch.delete(chatRef);

            await batch.commit();
        }
    } catch (e) {
        console.error("Error ending chat:", e);
    }
};
