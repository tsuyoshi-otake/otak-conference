import React from 'react';
import type { FooterControlsProps } from './types';
import { FooterControlsDesktop } from './FooterControlsDesktop';
import { FooterControlsMobile } from './FooterControlsMobile';

export const FooterControls: React.FC<FooterControlsProps> = (props) => (
  <div className="fixed bottom-0 left-0 right-0 bg-gray-800 bg-opacity-90 backdrop-blur-sm border-t border-gray-700 p-3 z-20">
    <div className="container mx-auto">
      <FooterControlsMobile {...props} />
      <FooterControlsDesktop {...props} />
    </div>
  </div>
);
