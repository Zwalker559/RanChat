"use client";

import { useState, useEffect } from "react";
import { Users } from "lucide-react";
import { collection, onSnapshot, query, where, getCountFromServer } from "firebase/firestore";
import { firestore } from "@/lib/firebase/config";

export function LiveUserCount() {
  const [userCount, setUserCount] = useState<number>(0);

  useEffect(() => {
    const usersCol = collection(firestore, 'users');
    const q = query(usersCol, where('status', '!=', 'offline'));
    
    // Get initial count
    getCountFromServer(q).then(snapshot => {
        setUserCount(snapshot.data().count);
    });

    const unsubscribe = onSnapshot(q, (snapshot) => {
        // This is not perfectly accurate for counts, but good enough for this app
        // For accurate counts, you'd use a server-side counter.
        setUserCount(snapshot.size);
    });

    return () => unsubscribe();
  }, []);

  return (
    <div className="flex items-center justify-center gap-2 text-lg text-muted-foreground">
      <Users className="h-5 w-5 text-accent" />
      <span className="font-medium">
        {userCount > 0 ? `${userCount.toLocaleString()} users online` : "Connecting..."}
      </span>
    </div>
  );
}
