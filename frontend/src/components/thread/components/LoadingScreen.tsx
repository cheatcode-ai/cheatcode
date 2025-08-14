import React from 'react';
import { FlickeringGrid } from './FlickeringGrid';
import { TextShimmer } from './TextShimmer';

interface LoadingScreenProps {
  agentStatus: string;
  onClose: () => void;
}

export const LoadingScreen: React.FC<LoadingScreenProps> = ({ agentStatus, onClose }) => {

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 relative overflow-hidden">
        {/* Flickering Grid Background */}
        <div className="absolute inset-0">
          <FlickeringGrid
            squareSize={4}
            gridGap={6}
            flickerChance={0.6}
            color="rgb(59, 130, 246)"
            maxOpacity={0.4}
            className="w-full h-full"
          />
        </div>

        {/* Main Content */}
        <div className="flex flex-col items-center max-w-md text-center relative z-10">
          <TextShimmer
            as="h3"
            className="text-3xl font-bold tracking-tight"
            duration={3}
            spread={1.5}
          >
            building the next big thing
          </TextShimmer>
        </div>
    </div>
  );
}; 