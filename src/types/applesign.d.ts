declare module 'applesign' {
  export default class Applesign {
    constructor(options: {
      mobileprovision?: string;
      outfile?: string;
      bundleId?: string;
      [key: string]: any;
    });

    signIPA(ipaPath: string): Promise<any>;
  }
}
