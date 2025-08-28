'use client';

import { createContext, useContext, ReactNode } from 'react';

interface RefetchControlContextType {
  disableRefetching?: boolean;
  disableWindowFocus?: boolean;
  disableInterval?: boolean;
  disableMount?: boolean;
  disableReconnect?: boolean;
}

const RefetchControlContext = createContext<RefetchControlContextType>({});

export function RefetchControlProvider({ 
  children, 
  disableRefetching = false,
  disableWindowFocus = false,
  disableInterval = false,
  disableMount = false,
  disableReconnect = false
}: { 
  children: ReactNode; 
  disableRefetching?: boolean;
  disableWindowFocus?: boolean;
  disableInterval?: boolean;
  disableMount?: boolean;
  disableReconnect?: boolean;
}) {
  const contextValue: RefetchControlContextType = {
    disableRefetching,
    disableWindowFocus: disableRefetching || disableWindowFocus,
    disableInterval: disableRefetching || disableInterval,
    disableMount: disableRefetching || disableMount,
    disableReconnect: disableRefetching || disableReconnect,
  };

  return (
    <RefetchControlContext.Provider value={contextValue}>
      {children}
    </RefetchControlContext.Provider>
  );
}

export function useRefetchControl() {
  return useContext(RefetchControlContext);
}
