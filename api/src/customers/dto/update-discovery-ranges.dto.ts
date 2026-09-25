import { ArrayMaxSize, IsArray, IsString, MaxLength } from 'class-validator';

// Shape-only validation here - what counts as an acceptable range (private,
// no wider than /16) lives in discovery-ranges.util.ts, which also produces
// the Portuguese message naming the bad entry. The array cap is looser than
// MAX_DISCOVERY_RANGES since blank lines are dropped before that check.
export class UpdateDiscoveryRangesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ranges: string[];
}
