"use client";
import {useState, useEffect, createContext, useContext, ReactNode} from 'react';
import {onAuthStateChanged, signInAnonymously, User as FirebaseAuthUser} from 'firebase/auth';
import { auth, firestore } from '@/lib/firebase/config';
import {doc, onSnapshot} from 'firebase/firestore';
import type {User as AppUser} from '@/lib/types';

interface AuthContextType {
    user: FirebaseAuthUser | null;
    appUser: AppUser | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({children}: {children: ReactNode}) => {
    const [user, setUser] = useState<FirebaseAuthUser | null>(null);
    const [appUser, setAppUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                const userRef = doc(firestore, 'users', firebaseUser.uid);
                const unsubUser = onSnapshot(userRef, (doc) => {
                   if (doc.exists()) {
                       setAppUser(doc.data() as AppUser);
                   }
                   setLoading(false);
                });
                return () => unsubUser();

            } else {
                try {
                    const userCredential = await signInAnonymously(auth);
                    setUser(userCredential.user);
                } catch (error) {
                    console.error("Anonymous sign in failed", error);
                } finally {
                    setLoading(false);
                }
            }
        });

        return () => unsubscribe();
    }, []);

    const value = {user, appUser, loading};

    return (
        <AuthContext.Provider value={value}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
