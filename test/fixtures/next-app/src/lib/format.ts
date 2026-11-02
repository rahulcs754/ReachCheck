import _ from "lodash";

const tpl = _.template("$<%= value %>");

export function price(value: number) {
  return tpl({ value });
}
