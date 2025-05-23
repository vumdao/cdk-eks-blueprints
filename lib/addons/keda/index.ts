import { ServiceAccount } from 'aws-cdk-lib/aws-eks';
import { ManagedPolicy } from "aws-cdk-lib/aws-iam";
import { Construct } from 'constructs';
import { merge } from "ts-deepmerge";
import { ClusterInfo, Values } from "../../spi";
import { createNamespace, setPath, supportsALL } from "../../utils";
import { HelmAddOn, HelmAddOnProps, HelmAddOnUserProps } from "../helm-addon";

/**
 * User provided options for the Helm Chart
 */
export interface KedaAddOnProps extends HelmAddOnUserProps {
    /**
     * Version of the helm chart to deploy
     */
    version?: string;
    /**
     * Name of the KEDA operator
     */
    kedaOperatorName?: string;
    /**
     * The name of the service account to use. If not set and create is true, a name is generated.
     */
    kedaServiceAccountName?: string;
    /**
     * securityContext: fsGroup
     * Check the workaround for SQS Scalar with IRSA https://github.com/kedacore/keda/issues/837#issuecomment-789037326
     *
     * @deprecated Has no effect for version 2.14 and above. Update podSecurityContext.operator.fsGroup in Values instead. KEDA-is-secure-by-default with fsGroup: 1000
     */
    podSecurityContextFsGroup?: number;
    /**
     * securityContext:runAsGroup
     * Check the workaround for SQS Scalar with IRSA https://github.com/kedacore/keda/issues/837#issuecomment-789037326
     *
     * @deprecated Has no effect for version 2.14 and above. Update podSecurityContext.operator.runAsGroup in Values instead. KEDA-is-secure-by-default with runAsGroup: 1000
     */
    securityContextRunAsGroup?: number;
    /**
     * securityContext:runAsUser
     * Check the workaround for SQS Scalar with IRSA https://github.com/kedacore/keda/issues/837#issuecomment-789037326
     *
     * @deprecated Has no effect for version 2.14 and above. Update podSecurityContext.operator.runAsUser in Values instead. KEDA-is-secure-by-default with runAsUser: 1000
     */
    securityContextRunAsUser?: number;
    /**
     * An array of Managed IAM Policies which Service Account of KEDA operator needs for IRSA Eg: irsaRoles:["CloudWatchFullAccess","AmazonSQSFullAccess"]. If not empty
     * Service Account will be Created by CDK with IAM Roles Mapped (IRSA). In case if its empty, Keda will create the Service Account with out IAM Roles
     */
    irsaRoles?: string[];

    /**
     * If set to true the namespace will be created. Default is true, since namespace is set to keda. 
     * Set to false if installing to kube-system or other existing namespace. 
     */
    createNamespace?: boolean,
}

/**
 * Default props to be used when creating the Helm chart
 */
const defaultProps: HelmAddOnProps & KedaAddOnProps = {
  name: "blueprints-keda-addon",
  chart: "keda",
  namespace:"keda",
  version: "2.17.0",
  release: "keda",
  repository:  "https://kedacore.github.io/charts",
  values: {},
  kedaOperatorName: "keda-operator",
  kedaServiceAccountName: "keda-operator",
  irsaRoles: [],
  createNamespace: true
};

/**
 * Main class to instantiate the Helm chart
 */
@supportsALL
export class KedaAddOn extends HelmAddOn {

  readonly options: KedaAddOnProps;
  constructor(props?: KedaAddOnProps) {
    super({...defaultProps, ...props});
    this.options = this.props as KedaAddOnProps;
  }

  deploy(clusterInfo: ClusterInfo): Promise<Construct> {

    const cluster = clusterInfo.cluster;
    let values: Values = populateValues(this.options);
    values = merge(values, this.props.values ?? {});

    let namespace: Construct | undefined = undefined;
    
    if(this.options.createNamespace) {
        namespace = createNamespace(this.options.namespace! , cluster);
    }
    const chart = this.addHelmChart(clusterInfo, values);

    if (this.options.irsaRoles!.length > 0) {
      //Create Service Account with IRSA
      const opts = { name: this.options.kedaOperatorName, namespace: this.options.namespace };
      const sa = cluster.addServiceAccount(this.options.kedaServiceAccountName!, opts);
      setRoles(sa, this.options.irsaRoles!);
      if(namespace) {
        sa.node.addDependency(namespace);
      }
      chart.node.addDependency(sa);
    } else if(namespace) {
      chart.node.addDependency(namespace);
    }
    return Promise.resolve(chart);
  }
}

/**
 * populateValues populates the appropriate values used to customize the Helm chart
 * @param helmOptions User provided values to customize the chart
 */
function populateValues(helmOptions: KedaAddOnProps): Values {
  const values = helmOptions.values ?? {};

  setPath(values, "operator.name",  helmOptions.kedaOperatorName);
  //In Case irsaRoles array is non empty, code should not allow Keda to create Service Account, CDK will create Service Account with IRSA enabled
  setPath(values, "serviceAccount.operator.create",  helmOptions.irsaRoles!.length > 0 ? false : true);
  setPath(values, "serviceAccount.operator.name",  helmOptions.kedaServiceAccountName);

  return values;
}

/**
 * This function will set the roles to Service Account
 * @param sa - Service Account Object
 * @param irsaRoles - Array  of Managed IAM Policies
 */
 function setRoles(sa:ServiceAccount, irsaRoles: string[]){
    irsaRoles.forEach((policyName) => {
        const policy = ManagedPolicy.fromAwsManagedPolicyName(policyName);
        sa.role.addManagedPolicy(policy);
      });
  }
