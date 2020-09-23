import {
  getCreate2MultisigAddress,
  getPublicIdentifierFromPublicKey,
} from "@connext/vector-utils";
import { Contract, ContractFactory, constants, BigNumber } from "ethers";

import { ChannelMastercopy, ChannelFactory } from "../artifacts";
import { VectorOnchainService } from "../onchainService";

import { initiator, counterparty, provider } from "./constants";
import { expect, getOnchainTxService } from "./utils";

describe("ChannelFactory", () => {
  const initiatorPubId = getPublicIdentifierFromPublicKey(initiator.publicKey);
  const counterpartyPubId = getPublicIdentifierFromPublicKey(counterparty.publicKey);
  let channelFactory: Contract;
  let channelMastercopy: Contract;
  let onchainService: VectorOnchainService;
  let chainId: number;

  beforeEach(async () => {
    chainId = (await provider.getNetwork()).chainId;

    channelMastercopy = await new ContractFactory(ChannelMastercopy.abi, ChannelMastercopy.bytecode, initiator).deploy();
    await channelMastercopy.deployed();

    channelFactory = await new ContractFactory(ChannelFactory.abi, ChannelFactory.bytecode, initiator).deploy(
      channelMastercopy.address,
    );
    await channelFactory.deployed();
    onchainService = await getOnchainTxService(provider);
  });

  it("should deploy", async () => {
    expect(channelFactory.address).to.be.a("string");
  });

  it("should create a channel", async () => {
    const created = new Promise((res) => {
      channelFactory.once(channelFactory.filters.ChannelCreation(), res);
    });
    const tx = await channelFactory.createChannel(counterparty.address);
    expect(tx.hash).to.be.a("string");
    await tx.wait();
    const channelAddress = await created;
    const computedAddr = await getCreate2MultisigAddress(
      initiatorPubId,
      counterpartyPubId,
      chainId,
      channelFactory.address,
      channelMastercopy.address,
      onchainService,
    );
    expect(channelAddress).to.be.a("string");
    expect(channelAddress).to.be.eq(computedAddr.getValue());
  });

  it("should create a channel with a deposit", async () => {
    // Use funded account for initiator
    const created = new Promise<string>((res) => {
      channelFactory.once(channelFactory.filters.ChannelCreation(), (data) => {
        res(data);
      });
    });
    const value = BigNumber.from("1000");
    const tx = await channelFactory
      .connect(initiator)
      .createChannelAndDeposit(counterparty.address, constants.AddressZero, value, { value });
    expect(tx.hash).to.be.a("string");
    await tx.wait();
    const channelAddress = await created;
    const computedAddr = await getCreate2MultisigAddress(
      initiatorPubId,
      counterpartyPubId,
      chainId,
      channelFactory.address,
      channelMastercopy.address,
      onchainService,
    );
    expect(channelAddress).to.be.a("string");
    expect(channelAddress).to.be.eq(computedAddr.getValue());

    const balance = await provider.getBalance(channelAddress as string);
    expect(balance).to.be.eq(value);

    const latestDeposit = await new Contract(channelAddress, ChannelMastercopy.abi, initiator).getLatestDeposit(
      constants.AddressZero,
    );
    expect(latestDeposit.nonce).to.be.eq(1);
    expect(latestDeposit.amount).to.be.eq(value);
  });
});
