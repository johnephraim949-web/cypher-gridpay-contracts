#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    token, vec, Address, BytesN, Env, Vec,
};

fn sha256(env: &Env, data: &soroban_sdk::Bytes) -> BytesN<32> {
    env.crypto().sha256(data).into()
}

fn hash_pair(env: &Env, a: &BytesN<32>, b: &BytesN<32>) -> BytesN<32> {
    let mut left = a.clone();
    let mut right = b.clone();
    if right.to_array() < left.to_array() {
        core::mem::swap(&mut left, &mut right);
    }
    let mut data = soroban_sdk::Bytes::from_array(env, &[0x01u8]);
    data.extend_from_array(&left.to_array());
    data.extend_from_array(&right.to_array());
    sha256(env, &data)
}

fn leaf_hash(
    env: &Env,
    contract: &Address,
    pool_id: u64,
    index: u32,
    claimant: &Address,
    amount: i128,
) -> BytesN<32> {
    let mut data = soroban_sdk::Bytes::new(env);
    data.extend_from_slice(b"GRIDPAY_REBATE_V1");
    data.append(&contract.clone().to_xdr(env));
    data.extend_from_array(&pool_id.to_be_bytes());
    data.extend_from_array(&index.to_be_bytes());
    data.append(&claimant.clone().to_xdr(env));
    data.extend_from_array(&amount.to_be_bytes());
    sha256(env, &data)
}

fn build_root_and_proofs(
    env: &Env,
    leaves: &[(u32, Address, i128)],
    contract: &Address,
    pool_id: u64,
) -> (BytesN<32>, std::vec::Vec<Vec<BytesN<32>>>) {
    let mut level: std::vec::Vec<BytesN<32>> = leaves
        .iter()
        .map(|(i, c, a)| leaf_hash(env, contract, pool_id, *i, c, *a))
        .collect();
    let mut idxs: std::vec::Vec<usize> = (0..level.len()).collect();
    let mut proofs: std::vec::Vec<std::vec::Vec<BytesN<32>>> =
        vec![std::vec::Vec::new(); level.len()];
    while level.len() > 1 {
        if level.len() % 2 == 1 {
            let last = level.last().unwrap().clone();
            level.push(last);
            idxs.push(*idxs.last().unwrap());
        }
        let mut next = std::vec::Vec::new();
        let mut next_idxs = std::vec::Vec::new();
        for pair in 0..(level.len() / 2) {
            let l = level[pair * 2].clone();
            let r = level[pair * 2 + 1].clone();
            for (pi, orig) in idxs.iter().enumerate().filter(|(_, o)| **o == pair * 2) {
                proofs[*orig].push(r.clone());
                let _ = pi;
            }
            for (pi, orig) in idxs.iter().enumerate().filter(|(_, o)| **o == pair * 2 + 1) {
                proofs[*orig].push(l.clone());
                let _ = pi;
            }
            next.push(hash_pair(env, &l, &r));
            next_idxs.push(pair * 2);
        }
        // rebuild idx mapping by original positions
        let mut remap = vec![usize::MAX; proofs.len()];
        for (new_pos, old_pos) in next_idxs.iter().enumerate() {
            remap[*old_pos] = new_pos * 2;
        }
        idxs = (0..proofs.len()).map(|_| 0usize).collect();
        level = next;
        // simple: recompute proofs by walking up again is easier; fallback below
        break;
    }
    // Simpler deterministic builder for small trees
    let mut leaves_h: std::vec::Vec<BytesN<32>> = leaves
        .iter()
        .map(|(i, c, a)| leaf_hash(env, contract, pool_id, *i, c, *a))
        .collect();
    let mut all_levels: std::vec::Vec<std::vec::Vec<BytesN<32>>> = vec![leaves_h.clone()];
    let mut cur = leaves_h;
    while cur.len() > 1 {
        if cur.len() % 2 == 1 {
            cur.push(cur.last().unwrap().clone());
        }
        let mut nxt = std::vec::Vec::new();
        for i in (0..cur.len()).step_by(2) {
            nxt.push(hash_pair(env, &cur[i], &cur[i + 1]));
        }
        all_levels.push(nxt.clone());
        cur = nxt;
    }
    let root = cur[0].clone();
    let mut out_proofs = std::vec::Vec::new();
    for mut idx in 0..leaves.len() {
        let mut p: Vec<BytesN<32>> = Vec::new(env);
        for lvl in 0..(all_levels.len() - 1) {
            let layer = &all_levels[lvl];
            let sib = if idx % 2 == 0 {
                if idx + 1 < layer.len() {
                    idx + 1
                } else {
                    idx
                }
            } else {
                idx - 1
            };
            p.push_back(layer[sib].clone());
            idx /= 2;
        }
        out_proofs.push(p);
    }
    (root, out_proofs)
}

fn setup(
    env: &Env,
) -> (
    PaymentContractClient<'_>,
    Address,
    Address,
    Address,
    token::StellarAssetClient<'_>,
) {
    let id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(env, &id);
    env.mock_all_auths();
    let admin = Address::generate(env);
    client.initialize(&admin);
    let token_admin = Address::generate(env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_addr = token_contract.address();
    let sac = token::StellarAssetClient::new(env, &token_addr);
    let sponsor = Address::generate(env);
    sac.mint(&sponsor, &1_000_000i128);
    (client, id, sponsor, token_addr, sac)
}

#[test]
fn rebate_pool_claim_verifies_and_prevents_double_claim() {
    let env = Env::default();
    env.ledger().set_timestamp(1000);
    let (client, contract_id, sponsor, token_addr, _) = setup(&env);
    let claimant = Address::generate(&env);
    let leaves = vec![
        (0u32, claimant.clone(), 100i128),
        (1u32, Address::generate(&env), 50i128),
    ];
    let (root, proofs) = build_root_and_proofs(&env, &leaves, &contract_id, 1);
    let pool_id = client.create_rebate_pool(&sponsor, &token_addr, &root, &150i128, &2000u64);
    client.claim_rebate(&claimant, &pool_id, &0u32, &100i128, &proofs[0]);
    let res = client.try_claim_rebate(&claimant, &pool_id, &0u32, &100i128, &proofs[0]);
    assert_eq!(res, Err(Ok(Error::Feature(FeatureError::RebateClaimed))));
}

#[test]
fn rebate_pool_rejects_tampered_and_cross_pool_proof() {
    let env = Env::default();
    env.ledger().set_timestamp(1000);
    let (client, contract_id, sponsor, token_addr, _) = setup(&env);
    let claimant = Address::generate(&env);
    let leaves = vec![(0u32, claimant.clone(), 100i128)];
    let (root, proofs) = build_root_and_proofs(&env, &leaves, &contract_id, 1);
    let pool_id = client.create_rebate_pool(&sponsor, &token_addr, &root, &100i128, &2000u64);
    let bad = client.try_claim_rebate(&claimant, &pool_id, &0u32, &101i128, &proofs[0]);
    assert_eq!(
        bad,
        Err(Ok(Error::Feature(FeatureError::InvalidRebateProof)))
    );
    let (root2, proofs2) = build_root_and_proofs(&env, &leaves, &contract_id, 2);
    let pool2 = client.create_rebate_pool(&sponsor, &token_addr, &root2, &100i128, &2000u64);
    let cross = client.try_claim_rebate(&claimant, &pool2, &0u32, &100i128, &proofs[0]);
    assert_eq!(
        cross,
        Err(Ok(Error::Feature(FeatureError::InvalidRebateProof)))
    );
    client.claim_rebate(&claimant, &pool2, &0u32, &100i128, &proofs2[0]);
}

#[test]
fn rebate_pool_rejects_overfunded_tree_and_reclaims_after_expiry() {
    let env = Env::default();
    env.ledger().set_timestamp(1000);
    let (client, contract_id, sponsor, token_addr, sac) = setup(&env);
    let c1 = Address::generate(&env);
    let c2 = Address::generate(&env);
    let leaves = vec![(0u32, c1.clone(), 60i128), (1u32, c2.clone(), 60i128)];
    let (root, proofs) = build_root_and_proofs(&env, &leaves, &contract_id, 1);
    let pool_id = client.create_rebate_pool(&sponsor, &token_addr, &root, &100i128, &2000u64);
    client.claim_rebate(&c1, &pool_id, &0u32, &60i128, &proofs[0]);
    let over = client.try_claim_rebate(&c2, &pool_id, &1u32, &60i128, &proofs[1]);
    assert_eq!(
        over,
        Err(Ok(Error::Feature(
            FeatureError::RebatePoolInsufficientFunds
        )))
    );
    let early = client.try_reclaim_expired_rebate_pool(&sponsor, &pool_id);
    assert_eq!(
        early,
        Err(Ok(Error::Feature(FeatureError::RebatePoolNotExpired)))
    );
    env.ledger().set_timestamp(2001);
    let reclaimed = client.reclaim_expired_rebate_pool(&sponsor, &pool_id);
    assert_eq!(reclaimed, 40i128);
    let bal = token::Client::new(&env, &token_addr).balance(&sponsor);
    assert!(bal >= 999_940i128);
    let _ = sac;
}
