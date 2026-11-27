"use server";

import {revalidatePath} from "next/cache";
import {z} from "zod";
import {account,scope} from "../../lib/scope";
import {approveFeeReview,submitFeeReview} from "../../lib/fee-review-record";
import type {ActionState} from "../actions/workflow";

const evidenceForm=z.object({id:z.uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/)});
export async function feeReviewAction(_state:ActionState,form:FormData):Promise<ActionState>{
  if(process.env.NEXUS_FEES_PREVIEW!=="true")return {error:"Sample review is disabled."};
  const [user,current]=await Promise.all([account(),scope(form.get("institution"),form.get("role"))]);
  try {
    const op=form.get("operation");
    if(op==="submit"){
      if(!await submitFeeReview(current,user))return {error:"Sample review was not created. Check access or refresh for an existing review."};
      revalidatePath("/fees");return {message:"Fictional review submitted. Nothing was posted."};
    }
    if(op==="approve"){
      const inputs=evidenceForm.safeParse({id:form.get("review"),digest:form.get("digest")});
      if(!inputs.success||!await approveFeeReview(current,user,inputs.data.id,inputs.data.digest))
        return {error:"Approval was not recorded. Check your review access and refresh."};
      revalidatePath("/fees");return {message:"Fictional approval recorded. Nothing was posted."};
    }
    return {error:"Unknown review action."};
  }catch{
    return {error:"The sample state could not be confirmed. Refresh before retrying."};
  }
}
