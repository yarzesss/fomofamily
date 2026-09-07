import React from 'react';
import { avatarFor } from '../lib/format.js';
export default function Avatar({ wallet, size = 28, className = '' }) {
  return <img className={`avatar ${className}`} src={avatarFor(wallet)} alt="" width={size} height={size} style={{ width: size, height: size }} />;
}
