import {
  Hex,
  SwitchChainError,
  WalletClient,
  createPublicClient,
  createWalletClient,
  fromHex,
  getAddress,
  http,
  numberToHex,
} from "viem";
import { toCoinbaseSmartAccount } from "viem/account-abstraction";
import { privateKeyToAccount } from "viem/accounts";
import { ChainNotConfiguredError, createConnector } from "wagmi";

headlessCSWConnector.type = "headlessCSWConnector" as const;

export function headlessCSWConnector({
  ownerPrivateKey,
  ownerIndex,
  address,
}: {
  ownerPrivateKey: Hex;
  ownerIndex: number;
  address: Hex;
}) {
  let connected = true;
  let walletClient: WalletClient;

  return createConnector<WalletClient>((config) => ({
    id: "headless-csw",
    name: "Headless Coinbase Smart Wallet",
    type: headlessCSWConnector.type,

    async setup() {
      this.connect({ chainId: config.chains[0].id });
    },
    async connect({ chainId } = {}) {
      try {
        await this.getProvider({ chainId });

        let currentChainId = await this.getChainId();
        if (chainId && currentChainId !== chainId) {
          const chain = await this.switchChain!({ chainId });
          currentChainId = chain.id;
        }

        connected = true;

        return {
          accounts: walletClient.account?.address
            ? [walletClient.account.address]
            : [],
          chainId: currentChainId,
        };
      } catch (error) {
        connected = false;
        console.error("Error connecting to Frame:", error);
        return { accounts: [], chainId: 0 };
      }
    },
    async disconnect() {
      connected = false;
    },
    async getAccounts() {
      if (!connected) throw new Error("Not connected");
      return walletClient.account?.address
        ? [walletClient.account.address]
        : [];
    },
    async getChainId() {
      const chainId = walletClient.chain?.id;

      if (!chainId) throw new Error("Not connected");

      return chainId;
    },
    async isAuthorized() {
      if (!connected) {
        return false;
      }

      const accounts = await this.getAccounts();
      return !!accounts.length;
    },
    async switchChain({ chainId }) {
      console.log("switching chain to", chainId);
      await this.getProvider({ chainId });
      const chain = config.chains.find((x) => x.id === chainId);
      if (!chain) throw new SwitchChainError(new ChainNotConfiguredError());
      this.onChainChanged(numberToHex(chainId));
      return chain;
    },
    onAccountsChanged(accounts) {
      if (accounts.length === 0) this.onDisconnect();
      else
        config.emitter.emit("change", {
          accounts: accounts.map((x) => getAddress(x)),
        });
    },
    onChainChanged(chain) {
      console.log("onChainChanged", chain);
      const chainId = Number(chain);
      config.emitter.emit("change", { chainId });
    },
    async onDisconnect() {
      config.emitter.emit("disconnect");
      connected = false;
    },
    async getProvider({ chainId } = {}) {
      console.log("creating provider for chainId", chainId);
      const ownerAccount = privateKeyToAccount(ownerPrivateKey);
      const chain =
        config.chains.find((x) => x.id === chainId) ?? config.chains[0];
      if (!chain) throw new ChainNotConfiguredError();

      const transport = config.transports?.[chain.id] ?? http();
      const publicClient = createPublicClient({
        chain,
        transport,
      });
      const account = await toCoinbaseSmartAccount({
        client: publicClient,
        owners: [ownerAccount],
        ownerIndex,
        address,
      });

      walletClient = createWalletClient({
        account,
        chain,
        transport,
      });

      return {
        ...walletClient,
        request: async (...args) => {
          console.log("request", args);
          if (args[0].method === "eth_sendTransaction") {
            console.log("custom handler! for eth_sendTransaction", args);
            const tx = args[0].params[0];
            const result = await walletClient.sendTransaction(tx);
            console.log({ result });
            return result;
          }

          const result = await walletClient.request(...args);
          console.log({ result });
          return result;
        },
      } as typeof walletClient;
    },
  }));
}
