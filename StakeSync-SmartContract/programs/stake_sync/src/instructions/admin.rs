use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::errors::StakeSyncError;
use crate::program::StakeSync;
use crate::state::Config;

/// Hard caps so no config change can take more: 60% of forfeits, 5% to join. Sponsor prizes and
/// finishers' own stakes are never charged.
pub const MAX_FEE_BPS: u16 = 6_000;
pub const MAX_JOIN_FEE_BPS: u16 = 500;

/// One-time setup. Only the program's upgrade authority can run it, so nobody can
/// front-run the deployment and make themselves admin.
#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + Config::INIT_SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = program.programdata_address()? == Some(program_data.key()))]
    pub program: Program<'info, StakeSync>,
    #[account(constraint = program_data.upgrade_authority_address == Some(admin.key()) @ StakeSyncError::NotUpgradeAuthority)]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeConfig>, verifier: Pubkey, treasury: Pubkey, fees: Fees) -> Result<()> {
    fees.validate()?;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.verifier = verifier;
    config.treasury = treasury;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.fee_bps = fees.forfeit_bps;
    config.join_fee_bps = fees.join_bps;
    config.paused = false;
    config.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = admin)]
    pub config: Account<'info, Config>,
}

/// Platform fees in basis points (100 = 1%).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct Fees {
    /// Platform's share of forfeited stakes and penalties (the rest goes to finishers).
    pub forfeit_bps: u16,
    /// On top of each stake when joining.
    pub join_bps: u16,
}

impl Fees {
    pub fn validate(&self) -> Result<()> {
        require!(
            self.forfeit_bps <= MAX_FEE_BPS && self.join_bps <= MAX_JOIN_FEE_BPS,
            StakeSyncError::FeeTooHigh
        );
        Ok(())
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, Default)]
pub struct ConfigUpdate {
    pub admin: Option<Pubkey>,
    pub verifier: Option<Pubkey>,
    pub treasury: Option<Pubkey>,
    pub fees: Option<Fees>,
    pub paused: Option<bool>,
}

/// Governance only. Nothing here can reach a challenge vault, and fee changes
/// only affect challenges created afterwards.
pub fn update_config(ctx: Context<UpdateConfig>, update: ConfigUpdate) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if let Some(fees) = update.fees {
        fees.validate()?;
        config.fee_bps = fees.forfeit_bps;
        config.join_fee_bps = fees.join_bps;
    }
    if let Some(v) = update.verifier {
        config.verifier = v;
    }
    if let Some(t) = update.treasury {
        config.treasury = t;
    }
    if let Some(p) = update.paused {
        config.paused = p;
    }
    if let Some(a) = update.admin {
        config.admin = a;
    }
    Ok(())
}
