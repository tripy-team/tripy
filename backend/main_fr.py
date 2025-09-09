# return {
#     "success": True,
#     "access_token": auth_result["AccessToken"],
#     "id_token": id_token,
#     "refresh_token": auth_result["RefreshToken"],
#     "token_type": auth_result["TokenType"],
#     "expires_in": auth_result["ExpiresIn"],
#     "user_info": user_info,
# }


# assume login has been ran
def after_logging_in(login_results):
    access_token = login_results["access_token"]
