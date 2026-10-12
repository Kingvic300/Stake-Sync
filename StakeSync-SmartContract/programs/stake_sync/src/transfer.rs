use anchor_lang::prelude::*;
use anchor_spl::token_interface::{transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::state::Challenge;

/// User or sponsor pays into a challenge vault.
pub fn deposit<'info>(
    token_program: &Interface<'info, TokenInterface>,
    from: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    owner: &Signer<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    transfer_checked(
        CpiContext::new(
            token_program.key(),
            TransferChecked { from: from.to_account_info(), mint: mint.to_account_info(), to: vault.to_account_info(), authority: owner.to_account_info() },
        ),
        amount,
        mint.decimals,
    )
}

/// The only way funds leave a vault: signed by the challenge PDA, inside a rule-checked instruction.
pub fn pay_out<'info>(
    token_program: &Interface<'info, TokenInterface>,
    challenge: &Account<'info, Challenge>,
    vault: &InterfaceAccount<'info, TokenAccount>,
    mint: &InterfaceAccount<'info, Mint>,
    to: &InterfaceAccount<'info, TokenAccount>,
    amount: u64,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let id = challenge.id.to_le_bytes();
    let seeds: &[&[u8]] = &[b"challenge", challenge.creator.as_ref(), &id, &[challenge.bump]];
    transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked { from: vault.to_account_info(), mint: mint.to_account_info(), to: to.to_account_info(), authority: challenge.to_account_info() },
            &[seeds],
        ),
        amount,
        mint.decimals,
    )
}
