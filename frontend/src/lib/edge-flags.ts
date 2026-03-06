export type IMaintenanceNotice =
  | {
      enabled: true;
      startTime: Date;
      endTime: Date;
    }
  | {
      enabled: false;
      startTime?: undefined;
      endTime?: undefined;
    };
