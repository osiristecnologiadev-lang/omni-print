'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createContract, cancelContract, type ContractPricingModel, type CreateContractInput } from '@/lib/api';

function num(formData: FormData, name: string): number {
  return Number(String(formData.get(name) ?? '0').replace(',', '.'));
}
function optNum(formData: FormData, name: string): number | undefined {
  const raw = String(formData.get(name) ?? '').trim();
  return raw ? Number(raw.replace(',', '.')) : undefined;
}
function optStr(formData: FormData, name: string): string | undefined {
  return String(formData.get(name) ?? '').trim() || undefined;
}

function readContractForm(formData: FormData): CreateContractInput {
  const pricingModel = String(formData.get('pricingModel') ?? 'ALLOWANCE_PLUS_OVERAGE') as ContractPricingModel;

  const base: CreateContractInput = {
    pricingModel,
    startDate: String(formData.get('startDate') ?? ''),
    endDate: optStr(formData, 'endDate'),
    billingDay: Number(formData.get('billingDay') ?? 10),
    setupFee: optNum(formData, 'setupFee'),
    earlyTerminationFee: optNum(formData, 'earlyTerminationFee'),
    adjustmentIndex: optStr(formData, 'adjustmentIndex'),
    notes: optStr(formData, 'notes'),
  };

  if (pricingModel === 'FLAT_RATE') {
    return { ...base, fixedFee: num(formData, 'fixedFee') };
  }
  if (pricingModel === 'ALLOWANCE_PLUS_OVERAGE') {
    return {
      ...base,
      fixedFee: num(formData, 'fixedFee'),
      includedPagesMono: Number(formData.get('includedPagesMono') ?? 0),
      includedPagesColor: Number(formData.get('includedPagesColor') ?? 0),
      overagePriceMono: num(formData, 'overagePriceMono'),
      overagePriceColor: num(formData, 'overagePriceColor'),
    };
  }
  // PER_PAGE
  return {
    ...base,
    fixedFee: optNum(formData, 'fixedFee'),
    pricePerPageMono: num(formData, 'pricePerPageMono'),
    pricePerPageColor: num(formData, 'pricePerPageColor'),
    minimumPagesMono: Number(formData.get('minimumPagesMono') ?? 0),
    minimumPagesColor: Number(formData.get('minimumPagesColor') ?? 0),
  };
}

export async function createContractAction(customerId: string, formData: FormData) {
  const input = readContractForm(formData);

  try {
    await createContract(customerId, input);
  } catch {
    redirect(`/customers/${customerId}/contract?error=1`);
  }

  revalidatePath(`/customers/${customerId}/contract`);
  redirect(`/customers/${customerId}/contract?saved=1`);
}

export async function cancelContractAction(customerId: string, contractId: string) {
  await cancelContract(customerId, contractId);
  revalidatePath(`/customers/${customerId}/contract`);
}
