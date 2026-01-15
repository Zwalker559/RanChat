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
  // Use setDoc with merge to create or update user info
  await setDoc(userRef, newUser, { merge: true });
  await setDoc(doc(firestore, 'active_users', uid), { uid, lastSeen: serverTimestamp() });
  return newUser;
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
      const activeUserRef = doc(firestore, 'active_users', uid);
      const queueRef = doc(firestore, 'queue', uid);

      const batch = writeBatch(firestore);
      batch.delete(userRef);
      batch.delete(activeUserRef);
      batch.delete(queueRef);
      
      await batch.commit();
    } catch(e) {
      console.error("Error deleting user from firestore", e);
    }
};


export const updateUserStatus = async (uid: string, status: User['status']) => {
  if (!uid) return;
  const userRef = doc(firestore, 'users', uid);
  const activeUserRef = doc(firestore, 'active_users', uid);
  try {
    const userDoc = await getDoc(userRef);
    if (!userDoc.exists()) return; // Don't try to update a non-existent user

    if (status === 'offline' || status === 'deleted') {
      await deleteDoc(activeUserRef);
    } else {
      await setDoc(activeUserRef, { uid, lastSeen: serverTimestamp() }, { merge: true });
    }
    await updateDoc(userRef, {status});
  } catch(e) {
    console.log("Could not update user status", e);
  }
};

export const findPartner = async (
  uid: string,
  preferences: UserPreferences
) => {
  // Add user to the queue before searching
  await setDoc(doc(firestore, 'queue', uid), {
      uid,
      preferences,
      timestamp: serverTimestamp(),
    }, { merge: true });

  const queueRef = collection(firestore, 'queue');
  // Query for users other than myself
  const q = query(
      queueRef,
      where('uid', '!=', uid),
      orderBy('timestamp', 'asc'),
      limit(20) // Widen the search slightly
  );

  const querySnapshot = await getDocs(q);

  for (const partnerDoc of querySnapshot.docs) {
      const partnerData = partnerDoc.data();
      const partnerUid = partnerData.uid;
      const partnerPrefs = partnerData.preferences as UserPreferences;
      
      const selfGender = preferences.gender;
      const selfPref = preferences.matchPreference;
      
      const partnerGender = partnerPrefs.gender;
      const partnerPref = partnerPrefs.matchPreference;

      // Check for mutual preference match
      const selfMatch = selfPref === 'both' || selfPref === partnerGender;
      const partnerMatch = partnerPref === 'both' || partnerPref === selfGender;

      if (selfMatch && partnerMatch) {
          // Found a match
          const chatId = doc(collection(firestore, 'chats')).id;
          const chatRef = doc(firestore, 'chats', chatId);

          const chatData = {
            id: chatId,
            participants: [uid, partnerUid],
            createdAt: serverTimestamp(),
          };

          const batch = writeBatch(firestore);
          
          // Create the chat document
          batch.set(chatRef, chatData);
          
          // Remove both users from the queue
          batch.delete(doc(firestore, 'queue', uid));
          batch.delete(doc(firestore, 'queue', partnerUid));
          
          // Set both users' status to 'in-chat'
          batch.update(doc(firestore, 'users', uid), { status: 'in-chat' });
          batch.update(doc(firestore, 'users', partnerUid), { status: 'in-chat' });

          try {
              await batch.commit();
              // This user is the "caller" because they initiated the match
              return {chatId, partnerUid};
          } catch (error) {
              // This can happen if both users try to create the chat at the same time.
              // One will fail. The one that fails can just continue listening.
              console.log("Batch commit failed, likely a race condition. The other user probably created the chat.", error);
              return null;
          }
      }
  }

  // No suitable partner found in the queue
  return null;
};

export const listenForPartner = (uid: string, callback: (chatId: string | null, partnerUid: string | null) => void) => {
    // Listen for a chat document where this user is a participant
    const q = query(
        collection(firestore, 'chats'), 
        where('participants', 'array-contains', uid), 
        limit(1)
    );

    const unsubscribe = onSnapshot(q, async (snapshot) => {
        if (!snapshot.empty) {
            const chatDoc = snapshot.docs[0];
            const participants = chatDoc.data().participants as string[];
            const partnerUid = participants.find(p => p !== uid);
            
            // Check if user's status is 'searching', which means they were the "callee"
            const user = await getUser(uid);
            if (partnerUid && user?.status === 'searching') {
                callback(chatDoc.id, partnerUid);
            }
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
