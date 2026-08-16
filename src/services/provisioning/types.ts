import { ProvStatus } from '../../models/provisioning';

export interface ProvResult {
  status: ProvStatus;
  detail: string;
}
