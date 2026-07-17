import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface OwnerContextType {
  selectedOwner: string | undefined;
  setSelectedOwner: (owner: string | undefined) => void;
}

const OwnerContext = createContext<OwnerContextType>({
  selectedOwner: undefined,
  setSelectedOwner: () => {},
});

const STORAGE_KEY = 'ai_interview_selected_owner';

export function OwnerProvider({ children }: { children: React.ReactNode }) {
  const [selectedOwner, setSelectedOwnerState] = useState<string | undefined>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : undefined;
    } catch {
      return undefined;
    }
  });

  const setSelectedOwner = useCallback((owner: string | undefined) => {
    setSelectedOwnerState(owner);
    if (owner) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(owner));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  return (
    <OwnerContext.Provider value={{ selectedOwner, setSelectedOwner }}>
      {children}
    </OwnerContext.Provider>
  );
}

export function useOwner() {
  return useContext(OwnerContext);
}

export default OwnerContext;
