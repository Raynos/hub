import { jestBinaryRocksDB } from '~/storage/db/jestUtils';
import {
  CastAddModel,
  FollowAddModel,
  ReactionAddModel,
  SignerAddModel,
  UserDataAddModel,
  VerificationAddEthAddressModel,
} from '~/storage/flatbuffers/types';
import Factories from '~/test/factories/flatbuffer';
import Engine from '~/storage/engine/flatbuffers';
import MessageModel from '~/storage/flatbuffers/messageModel';
import CastStore from '~/storage/sets/flatbuffers/castStore';
import { KeyPair } from '~/types';
import ContractEventModel from '~/storage/flatbuffers/contractEventModel';
import { generateEd25519KeyPair } from '~/utils/crypto';
import { Wallet, utils } from 'ethers';
import { ValidationError } from '~/utils/errors';
import SignerStore from '~/storage/sets/flatbuffers/signerStore';
import FollowStore from '~/storage/sets/flatbuffers/followStore';
import ReactionStore from '~/storage/sets/flatbuffers/reactionStore';
import VerificationStore from '~/storage/sets/flatbuffers/verificationStore';
import UserDataStore from '~/storage/sets/flatbuffers/userDataStore';
import { CastId } from '~/utils/generated/message_generated';

const db = jestBinaryRocksDB('flatbuffers.engine.test');
const engine = new Engine(db);

// init stores for checking state changes from engine
const signerStore = new SignerStore(db);
const castStore = new CastStore(db);
const followStore = new FollowStore(db);
const reactionStore = new ReactionStore(db);
const verificationStore = new VerificationStore(db);
const userDataStore = new UserDataStore(db);

const fid = Factories.FID.build();

let custodyWallet: Wallet;
let custodyAddress: Uint8Array;
let custodyEvent: ContractEventModel;

let signer: KeyPair;
let signerAdd: SignerAddModel;

let castAdd: CastAddModel;
let followAdd: FollowAddModel;
let reactionAdd: ReactionAddModel;
let verificationAdd: VerificationAddEthAddressModel;
let userDataAdd: UserDataAddModel;

beforeAll(async () => {
  custodyWallet = Wallet.createRandom();
  custodyAddress = utils.arrayify(custodyWallet.address);
  custodyEvent = new ContractEventModel(
    await Factories.IdRegistryEvent.create({ fid: Array.from(fid), to: Array.from(custodyAddress) })
  );

  signer = await generateEd25519KeyPair();

  const signerAddData = await Factories.SignerAddData.create({
    fid: Array.from(fid),
    body: Factories.SignerBody.build({ signer: Array.from(signer.publicKey) }),
  });
  const signerAddMessage = await Factories.Message.create(
    { data: Array.from(signerAddData.bb?.bytes() ?? []) },
    { transient: { wallet: custodyWallet } }
  );
  signerAdd = new MessageModel(signerAddMessage) as SignerAddModel;

  const castAddData = await Factories.CastAddData.create({ fid: Array.from(fid) });
  const castAddMessage = await Factories.Message.create(
    { data: Array.from(castAddData.bb?.bytes() ?? []) },
    { transient: { signer } }
  );
  castAdd = new MessageModel(castAddMessage) as CastAddModel;

  const followAddData = await Factories.FollowAddData.create({ fid: Array.from(fid) });
  const followAddMessage = await Factories.Message.create(
    { data: Array.from(followAddData.bb?.bytes() ?? []) },
    { transient: { signer } }
  );
  followAdd = new MessageModel(followAddMessage) as FollowAddModel;

  const reactionAddData = await Factories.ReactionAddData.create({ fid: Array.from(fid) });
  const reactionAddMessage = await Factories.Message.create(
    { data: Array.from(reactionAddData.bb?.bytes() ?? []) },
    { transient: { signer } }
  );
  reactionAdd = new MessageModel(reactionAddMessage) as ReactionAddModel;

  const verificationAddBody = await Factories.VerificationAddEthAddressBody.create({}, { transient: { fid } });
  const verificationAddData = await Factories.VerificationAddEthAddressData.create({
    fid: Array.from(fid),
    body: verificationAddBody.unpack(),
  });
  const verificationAddMessage = await Factories.Message.create(
    { data: Array.from(verificationAddData.bb?.bytes() ?? []) },
    { transient: { signer } }
  );
  verificationAdd = new MessageModel(verificationAddMessage) as VerificationAddEthAddressModel;

  const userDataAddData = await Factories.UserDataAddData.create({ fid: Array.from(fid) });
  const userDataAddMessage = await Factories.Message.create(
    { data: Array.from(userDataAddData.bb?.bytes() ?? []) },
    { transient: { signer } }
  );
  userDataAdd = new MessageModel(userDataAddMessage) as UserDataAddModel;
});

describe('mergeIdRegistryEvent', () => {
  test('succeeds', async () => {
    await expect(engine.mergeIdRegistryEvent(custodyEvent)).resolves.toEqual(undefined);
    await expect(signerStore.getIdRegistryEvent(fid)).resolves.toEqual(custodyEvent);
  });
});

describe('mergeMessage', () => {
  describe('with valid signer', () => {
    beforeEach(async () => {
      await engine.mergeIdRegistryEvent(custodyEvent);
      await engine.mergeMessage(signerAdd);
    });

    describe('CastAdd', () => {
      test('succeeds', async () => {
        await expect(engine.mergeMessage(castAdd)).resolves.toEqual(undefined);
        await expect(castStore.getCastAdd(fid, castAdd.tsHash())).resolves.toEqual(castAdd);
      });
    });

    describe('FollowAdd', () => {
      test('succeeds', async () => {
        await expect(engine.mergeMessage(followAdd)).resolves.toEqual(undefined);
        await expect(
          followStore.getFollowAdd(fid, followAdd.body().user()?.fidArray() ?? new Uint8Array())
        ).resolves.toEqual(followAdd);
      });
    });

    describe('ReactionAdd', () => {
      test('succeeds', async () => {
        await expect(engine.mergeMessage(reactionAdd)).resolves.toEqual(undefined);
        await expect(
          reactionStore.getReactionAdd(fid, reactionAdd.body().type(), reactionAdd.body().cast() as CastId)
        ).resolves.toEqual(reactionAdd);
      });
    });

    describe('VerificationAddEthAddress', () => {
      test('succeeds', async () => {
        await expect(engine.mergeMessage(verificationAdd)).resolves.toEqual(undefined);

        await expect(
          verificationStore.getVerificationAdd(fid, verificationAdd.body().addressArray() ?? new Uint8Array())
        ).resolves.toEqual(verificationAdd);
      });
    });

    describe('UserDataAdd', () => {
      test('succeeds', async () => {
        await expect(engine.mergeMessage(userDataAdd)).resolves.toEqual(undefined);

        await expect(userDataStore.getUserDataAdd(fid, userDataAdd.body().type())).resolves.toEqual(userDataAdd);
      });
    });
  });

  describe('fails when missing signer', () => {
    let message: MessageModel;

    beforeEach(async () => {
      await engine.mergeIdRegistryEvent(custodyEvent);
    });

    afterEach(async () => {
      await expect(engine.mergeMessage(message)).rejects.toThrow(new ValidationError('invalid signer'));
    });

    test('with CastAdd', () => {
      message = castAdd;
    });
  });

  describe('fails when missing both custody address and signer', () => {
    let message: MessageModel;

    afterEach(async () => {
      await expect(engine.mergeMessage(message)).rejects.toThrow(new ValidationError('unknown user'));
    });

    test('with CastAdd', () => {
      message = castAdd;
    });
  });
});
