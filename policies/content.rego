package agt004

import rego.v1

brand_issues contains issue if {
  some rule in input.mission.brandRules
  startswith(rule, "FORBID:")
  term := trim_space(trim_prefix(rule, "FORBID:"))
  term != ""
  contains(lower(input.version.body), lower(term))
  issue := {
    "code": "BRAND_RULE",
    "message": sprintf("Forbidden brand term is present: %s", [term]),
    "path": "body",
  }
}

policy_issues contains issue if {
  some rule in input.mission.policies
  startswith(rule, "FORBID:")
  term := trim_space(trim_prefix(rule, "FORBID:"))
  term != ""
  contains(lower(input.version.body), lower(term))
  issue := {
    "code": "POLICY_RULE",
    "message": sprintf("Forbidden policy term is present: %s", [term]),
    "path": "body",
  }
}

disclosure_issues contains issue if {
  some rule in input.mission.policies
  startswith(rule, "REQUIRE_DISCLOSURE:")
  disclosure := trim_space(trim_prefix(rule, "REQUIRE_DISCLOSURE:"))
  disclosure != ""
  not contains(input.version.body, disclosure)
  issue := {
    "code": "MISSING_DISCLOSURE",
    "message": sprintf("Required disclosure is missing: %s", [disclosure]),
    "path": "body",
  }
}

issues := array.concat(
  [x | some x in brand_issues],
  array.concat(
    [x | some x in policy_issues],
    [x | some x in disclosure_issues],
  ),
)

result := {
  "passed": count(issues) == 0,
  "issues": issues,
}
