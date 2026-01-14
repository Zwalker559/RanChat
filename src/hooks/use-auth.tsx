"use client";
import {useState, useEffect, createContext, useContext, ReactNode} from 'react';
import {onAuthStateChanged, signInAnonymously, User as FirebaseAuthUser, AuthError} from 'firebase/auth';
import { auth, firestore } from '@/lib/firebase/config';
import {doc, onSnapshot} from 'firebase/firestore';
import type {User as AppUser} from '@/lib/types';

interface AuthContextType {
    user: FirebaseAuthUser | null;
    appUser: AppUser | null;
    loading: boolean;
    authError: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({children}: {children: ReactNode}) => {
    const [user, setUser] = useState<FirebaseAuthUser | null>(null);
    const [appUser, setAppUser] = useState<AppUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [authError, setAuthError] = useState<string|null>(null);

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
                    const authError = error as AuthError;
                    if (authError.code === 'auth/admin-restricted-operation' || authError.code === 'auth/operation-not-allowed') {
                        const errorMessage = `
================================================================================
FIREBASE AUTHENTICATION ERROR
Anonymous Sign-In is not enabled for your Firebase project.
Please enable it in the Firebase Console:
1. Go to your Firebase project.
2. Navigate to Authentication -> Sign-in method.
3. Find 'Anonymous' in the provider list and enable it.
================================================================================
`;
                        console.error(errorMessage);
                        setAuthError("Anonymous sign-in is disabled in your Firebase project. Please check the browser console for instructions on how to fix this.");
                    } else {
                         console.error("Anonymous sign in failed", error);
                         setAuthError("An unexpected authentication error occurred.");
                    }
                } finally {
                    setLoading(false);
                }
            }
        });

        return () => unsubscribe();
    }, []);

    const value = {user, appUser, loading, authError};
    
    if (authError) {
        return (
            <div className="flex h-screen items-center justify-center bg-background text-destructive p-8 text-center">
                <div className="max-w-md">
                    <h1 className="text-xl font-bold mb-4">Authentication Error</h1>
                    <p>{authError}</p>
                    <p className="text-sm text-muted-foreground mt-2">Open the developer console for more details.</p>
                </div>
            </div>
        )
    }


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
