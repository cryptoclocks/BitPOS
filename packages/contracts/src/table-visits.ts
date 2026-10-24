export interface TableOccupancyView {
 generation:string;active:boolean;joined:boolean;openedAt:string|null;lastActivityAt:string|null;timeoutMinutes:number;
}
export interface TableClearRequest {expectedGeneration:string;idempotencyKey:string;confirmClear:true;}
export interface TableClearResult {
 cleared:true;generation:string;effects:{deviceId:string;eventId:string;screenGeneration:string}[];
 preserved:{bills:true;payments:true;walletPermissions:true};
}
