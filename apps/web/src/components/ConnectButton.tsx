'use client';

import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { injected } from 'wagmi/connectors';

export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <button
        onClick={() => disconnect()}
        className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 transition"
      >
        {address.slice(0, 6)}...{address.slice(-4)}
      </button>
    );
  }

  return (
    <button
      onClick={() => connect({ connector: injected({ target: 'metaMask' }) })}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition"
    >
      Connect Wallet
    </button>
  );
}
